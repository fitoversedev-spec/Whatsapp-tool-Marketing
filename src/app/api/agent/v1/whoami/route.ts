import { getEffectiveTable } from "@/lib/agent/permissions";
import { getRateLimits } from "@/lib/agent/ratelimit";
import { whoamiResponseSchema } from "@/lib/agent/schemas";
import { withAgent } from "@/lib/agent/withAgent";
import type { z } from "zod/v4";

// The developers' connection test: proves the key works and shows exactly what
// it may do. Read-only, returns nothing about customers or other keys.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent(
  "whoami",
  async ({ ctx, meta }) => {
    const [permissions, rateLimits] = await Promise.all([getEffectiveTable(), getRateLimits()]);
    const body: z.infer<typeof whoamiResponseSchema> = {
      identity: { name: meta.identityName },
      environment: ctx.environment,
      credential: {
        label: meta.credentialLabel,
        prefix: meta.keyPrefix,
        expiresAt: meta.expiresAt ? meta.expiresAt.toISOString() : null,
      },
      permissions,
      rateLimits,
      serverTime: new Date().toISOString(),
    };
    return { body };
  },
  { mutating: false },
);
