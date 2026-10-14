import { z } from "zod/v4";
import { AGENT_ENVIRONMENTS } from "./context";
import { AGENT_ERROR_CODES } from "./errors";

/**
 * Response shapes for the agent API. Routes use them to type their output and
 * openapi.ts turns the same objects into the published OpenAPI document, so the
 * docs cannot drift from the code.
 *
 * zod/v4 (shipped inside the installed zod 3.x) is used here because it can
 * emit JSON Schema; the rest of the app keeps using plain "zod".
 */
export const environmentSchema = z.enum(AGENT_ENVIRONMENTS as [string, ...string[]]);

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.literal("v1"),
  environment: environmentSchema.nullable(),
});

export const verdictSchema = z.enum(["ALLOWED", "APPROVAL", "NEVER"]);

const limitSchema = z.object({
  perMinute: z.number().int().positive(),
  perHour: z.number().int().positive(),
});

export const whoamiResponseSchema = z.object({
  identity: z.object({ name: z.string() }),
  environment: environmentSchema,
  credential: z.object({
    label: z.string(),
    prefix: z.string().describe("Identifies the key (fvai_<env>_<keyId>); cannot be used to authenticate."),
    expiresAt: z.string().nullable().describe("ISO 8601, or null when the key does not expire."),
  }),
  permissions: z
    .record(z.string(), verdictSchema)
    .describe("Effective verdict per tool: ALLOWED runs now, APPROVAL waits for a human, NEVER is refused."),
  rateLimits: limitSchema.extend({ groups: z.record(z.string(), limitSchema) }),
  serverTime: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(AGENT_ERROR_CODES),
    message: z.string(),
    correlationId: z.string(),
  }),
});

export const approvalPendingSchema = z.object({
  approvalId: z.string(),
  status: z.literal("pending"),
});

export const openApiDocumentSchema = z.record(z.string(), z.unknown());
