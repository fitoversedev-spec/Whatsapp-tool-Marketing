import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { AGENT_ROUTES, buildOpenApi, pathParameters, queryParameters, type AgentRouteSpec } from "../openapi";
import { rateSheetQuerySchema, searchLeadsQuerySchema } from "../schemas/read";

type Param = { name: string; in: string; required: boolean; description?: string; schema: Record<string, any> };
type Doc = { paths: Record<string, Record<string, { parameters: Param[] }>> };

const byName = (params: Param[], name: string) => params.find((p) => p.name === name);

describe("pathParameters", () => {
  it("emits every {placeholder} as a required string path parameter", () => {
    expect(pathParameters("/leads/{id}/notes")).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ]);
    expect(pathParameters("/analytics/{report}").map((p) => (p as Param).name)).toEqual(["report"]);
    expect(pathParameters("/a/{x}/b/{y}").map((p) => (p as Param).name)).toEqual(["x", "y"]);
  });

  it("emits nothing for a path without placeholders", () => {
    expect(pathParameters("/whoami")).toEqual([]);
  });
});

describe("queryParameters", () => {
  it("publishes each property of the query schema as an `in: query` parameter", () => {
    const params = queryParameters(searchLeadsQuerySchema) as Param[];
    expect(params.map((p) => p.name)).toEqual(
      expect.arrayContaining(["q", "phone", "stageId", "ownerId", "source", "includeContacts", "limit", "cursor"]),
    );
    for (const p of params) expect(p.in).toBe("query");
    expect(byName(params, "q")!.schema).toMatchObject({ type: "string", maxLength: 100 });
    expect(byName(params, "includeContacts")!.schema.type).toBe("boolean");
  });

  it("treats optional and defaulted properties as optional", () => {
    const params = queryParameters(searchLeadsQuerySchema) as Param[];
    for (const p of params) expect(p.required, p.name).toBe(false);
    expect(byName(params, "limit")!.schema).toMatchObject({ type: "integer", minimum: 1, maximum: 100, default: 20 });
  });

  it("marks a property that has no default and cannot be omitted as required", () => {
    const params = queryParameters(rateSheetQuerySchema) as Param[];
    expect(byName(params, "sport")).toMatchObject({ in: "query", required: true });
    expect(byName(params, "sport")!.schema.enum).toContain("football");
  });

  it("lifts a described property's description onto the parameter", () => {
    const params = queryParameters(z.object({ since: z.string().describe("ISO time") })) as Param[];
    expect(params).toEqual([
      { name: "since", in: "query", required: true, schema: { type: "string", description: "ISO time" }, description: "ISO time" },
    ]);
  });

  it("skips names that are already path parameters", () => {
    const params = queryParameters(z.object({ id: z.string(), q: z.string().optional() }), new Set(["id"])) as Param[];
    expect(params.map((p) => p.name)).toEqual(["q"]);
  });
});

describe("buildOpenApi parameters", () => {
  const added: AgentRouteSpec[] = [];
  afterEach(() => {
    for (const r of added.splice(0)) AGENT_ROUTES.splice(AGENT_ROUTES.indexOf(r), 1);
  });

  it("lists path parameters for the routes that have {placeholders}", () => {
    const doc = buildOpenApi() as unknown as Doc;
    const leadGet = doc.paths["/leads/{id}"].get.parameters;
    expect(byName(leadGet, "id")).toEqual({ name: "id", in: "path", required: true, schema: { type: "string" } });
    // Routes without a placeholder gain no path parameter.
    expect(doc.paths["/whoami"].get.parameters.some((p) => p.in === "path" || p.in === "query")).toBe(false);
  });

  it("keeps the header parameters exactly as before", () => {
    const doc = buildOpenApi() as unknown as Doc;
    const headers = doc.paths["/whoami"].get.parameters.filter((p) => p.in === "header");
    expect(headers.map((p) => p.name)).toEqual(["X-Correlation-Id"]);
    const post = doc.paths["/leads"].post.parameters.filter((p) => p.in === "header");
    expect(post.map((p) => p.name)).toEqual(["X-Correlation-Id", "Idempotency-Key"]);
  });

  it("emits a route's querySchema between its path and header parameters", () => {
    const route: AgentRouteSpec = {
      path: "/zz-test/{id}",
      method: "get",
      tool: "whoami",
      summary: "test",
      querySchema: searchLeadsQuerySchema,
      responseSchema: z.object({}),
    };
    AGENT_ROUTES.push(route);
    added.push(route);
    const params = (buildOpenApi() as unknown as Doc).paths["/zz-test/{id}"].get.parameters;
    const kinds = params.map((p) => p.in);
    expect(kinds[0]).toBe("path");
    expect(kinds.filter((k) => k === "query").length).toBeGreaterThanOrEqual(8);
    expect(kinds.lastIndexOf("query")).toBeLessThan(kinds.indexOf("header"));
    expect(byName(params, "limit")!.in).toBe("query");
    expect(JSON.parse(JSON.stringify(params))).toEqual(params);
  });

  it("emits no query parameters when a route has no querySchema", () => {
    const route: AgentRouteSpec = {
      path: "/zz-plain",
      method: "get",
      tool: "whoami",
      summary: "test",
      responseSchema: z.object({}),
    };
    AGENT_ROUTES.push(route);
    added.push(route);
    const params = (buildOpenApi() as unknown as Doc).paths["/zz-plain"].get.parameters;
    expect(params.map((p) => p.in)).toEqual(["header"]);
  });
});
