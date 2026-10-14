import { z } from "zod/v4";

/** Response of get_approval_status: how one of the AI's own approval requests is going. */
export const approvalStatusResponseSchema = z.object({
  id: z.string(),
  tool: z.string().describe("The tool that was held for approval."),
  status: z
    .enum(["pending", "approved", "executed", "failed", "rejected", "expired"])
    .describe(
      "pending = waiting for a person; executed = approved and done; failed = approved but it did not go through (see failureReason); approved with a failureReason = approved but could not be run automatically; rejected / expired = nothing happened.",
    ),
  requestedAt: z.string(),
  expiresAt: z.string(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable().describe("What the person wrote when they decided, if anything."),
  executedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  result: z.unknown().describe("What the tool returned when it ran (the same body the tool would have returned). Null until then."),
});
