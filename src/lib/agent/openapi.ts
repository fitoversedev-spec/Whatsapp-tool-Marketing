import { AREA_ROUTES } from "./registry";
import { z } from "zod/v4";
import { TOOL_REGISTRY } from "./permissions";
import {
  approvalPendingSchema,
  errorResponseSchema,
  healthResponseSchema,
  openApiDocumentSchema,
  whoamiResponseSchema,
} from "./schemas";

/**
 * The agent API's route registry and the OpenAPI 3.1 document built from it.
 * Add a route here when you add it under src/app/api/agent/v1/, and the
 * developers' contract updates itself.
 */
export type AgentRouteSpec = {
  /** Path relative to /api/agent/v1 */
  path: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  /** TOOL_REGISTRY name, or null for the two public endpoints. */
  tool: string | null;
  summary: string;
  requestSchema?: z.ZodType;
  /**
   * GET routes: the zod object that validates the query string. Each property is
   * published as an OpenAPI `in: "query"` parameter (optional unless the schema
   * requires it and gives no default). Path parameters such as {id} are read
   * from `path` itself, so they are never listed here.
   */
  querySchema?: z.ZodType;
  responseSchema: z.ZodType;
};

const CORE_ROUTES: AgentRouteSpec[] = [
  {
    path: "/health",
    method: "get",
    tool: null,
    summary: "Liveness check. No authentication.",
    responseSchema: healthResponseSchema,
  },
  {
    path: "/whoami",
    method: "get",
    tool: "whoami",
    summary: "Connection test: who this key is, what it may do, and its rate limits.",
    responseSchema: whoamiResponseSchema,
  },
  {
    path: "/openapi.json",
    method: "get",
    tool: null,
    summary: "This document. No authentication.",
    responseSchema: openApiDocumentSchema,
  },
];

type JsonSchema = Record<string, unknown>;

function toSchema(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  const json = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as JsonSchema;
  delete json.$schema;
  return json;
}

/** `{id}`, `{report}` ... in a route path, as required OpenAPI path parameters. */
export function pathParameters(path: string): unknown[] {
  const names = Array.from(path.matchAll(/\{([A-Za-z0-9_]+)\}/g), (m) => m[1]);
  return Array.from(new Set(names)).map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

/**
 * One OpenAPI query parameter per property of the query schema. The schema is
 * rendered in "output" mode: that is the shape of a VALID value, which stays
 * accurate for the preprocess/coerce wrappers query strings need (input mode
 * would lose their type and mark every property required). A property with a
 * default is optional, since leaving it out is valid.
 */
export function queryParameters(schema: z.ZodType, reserved: ReadonlySet<string> = new Set()): unknown[] {
  const json = toSchema(schema, "output") as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  const required = new Set(json.required ?? []);
  const out: unknown[] = [];
  for (const [name, prop] of Object.entries(json.properties ?? {})) {
    if (reserved.has(name)) continue;
    const parameter: Record<string, unknown> = {
      name,
      in: "query",
      required: required.has(name) && !("default" in prop),
      schema: prop,
    };
    if (typeof prop.description === "string") parameter.description = prop.description;
    out.push(parameter);
  }
  return out;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorResponse = (description: string, extra?: JsonSchema) => ({
  description,
  ...extra,
  content: { "application/json": { schema: ref("Error") } },
});

export const AGENT_ROUTES: AgentRouteSpec[] = [...CORE_ROUTES, ...AREA_ROUTES];

export function buildOpenApi(): JsonSchema {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of AGENT_ROUTES) {
    const tool = route.tool ? TOOL_REGISTRY[route.tool] : undefined;
    const authenticated = route.tool !== null;
    const mutating = !!tool && tool.action !== "read";

    const pathParams = pathParameters(route.path);
    const parameters: unknown[] = [
      ...pathParams,
      ...(route.querySchema
        ? queryParameters(route.querySchema, new Set(pathParams.map((p) => (p as { name: string }).name)))
        : []),
      {
        name: "X-Correlation-Id",
        in: "header",
        required: false,
        description: "8-64 chars of [A-Za-z0-9._-]. Echoed back; generated when absent or invalid.",
        schema: { type: "string", pattern: "^[A-Za-z0-9._-]{8,64}$" },
      },
    ];
    if (mutating) {
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        description: "8-128 chars of [A-Za-z0-9._:-]. A retry with the same key and body replays the first response.",
        schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{8,128}$" },
      });
    }

    const responses: Record<string, unknown> = {
      "200": {
        description: "Success",
        content: { "application/json": { schema: toSchema(route.responseSchema, "output") } },
      },
    };
    if (authenticated) {
      responses["401"] = errorResponse("Missing, invalid, expired or revoked key", {
        headers: { "WWW-Authenticate": { schema: { type: "string" } } },
      });
      responses["403"] = errorResponse("Tool is not permitted (never_allowed)");
      responses["429"] = errorResponse("Rate limit exceeded", {
        headers: { "Retry-After": { schema: { type: "integer" }, description: "Seconds" } },
      });
      responses["500"] = errorResponse("Internal error");
      if (mutating) {
        responses["202"] = {
          description: "Held for human approval",
          content: { "application/json": { schema: ref("ApprovalPending") } },
        };
        responses["400"] = errorResponse("Invalid input or Idempotency-Key");
        responses["409"] = errorResponse("Same Idempotency-Key still in progress", {
          headers: { "Retry-After": { schema: { type: "integer" }, description: "Seconds" } },
        });
        responses["422"] = errorResponse("Idempotency-Key reused with a different request");
      }
    }

    const operation: Record<string, unknown> = {
      operationId: route.tool ?? route.path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      summary: route.summary,
      tags: [authenticated ? "agent" : "public"],
      parameters,
      responses,
      ...(authenticated ? { security: [{ bearerAuth: [] }] } : { security: [] }),
      ...(route.tool ? { "x-tool": route.tool, "x-default-verdict": tool?.default ?? "NEVER" } : {}),
    };
    if (route.requestSchema) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: toSchema(route.requestSchema, "input") } },
      };
    }

    (paths[route.path] ??= {})[route.method] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Fitoverse AI Sales Agent API",
      version: "v1",
      description:
        "Least-privilege integration surface for the Fitoverse AI Sales Agent. Authenticate with " +
        "`Authorization: Bearer fvai_<env>_<keyId>_<secret>`. Every response carries X-Correlation-Id; " +
        "every error has the shape { error: { code, message, correlationId } }.",
    },
    servers: [{ url: "/api/agent/v1" }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Agent API key" } },
      schemas: {
        Error: toSchema(errorResponseSchema, "output"),
        ApprovalPending: toSchema(approvalPendingSchema, "output"),
      },
    },
  };
}
