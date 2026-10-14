/**
 * What runs when a person approves one of the AI's deal or campaign requests.
 *
 * Each executor takes the input stored with the approval, validates it again
 * (a stored request is data like any other), and runs the SAME handler the tool
 * uses. Nothing is trusted from the time of the request: the launch and schedule
 * handlers re-read the recipients, opt-outs, consent, template and the
 * campaign caps when they run (see broadcasts.ts).
 */
import type { z } from "zod/v4";
import type { AgentContext } from "../context";
import { AgentHttpError, buildErrorBody } from "../errors";
import type { ApprovalExecutor } from "../executors";
import {
  launchBroadcastInputSchema,
  scheduleBroadcastInputSchema,
  setDealExecutionStatusInputSchema,
  updateDealWonValueInputSchema,
} from "../schemas/deals";
import type { AgentHandlerResult } from "../withAgent";
import { launchBroadcast, scheduleBroadcast } from "./broadcasts";
import { setDealExecutionStatus, updateDealWonValue } from "./dealEdits";

function make<S extends z.ZodType>(
  schema: S,
  idKey: string,
  run: (args: { ctx: AgentContext; input: z.infer<S> }) => Promise<AgentHandlerResult>,
): ApprovalExecutor {
  return async ({ ctx, input }) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { status: 400, body: buildErrorBody("invalid_input", "The stored request is no longer valid.", ctx.correlationId) };
    }
    const data = parsed.data as z.infer<S>;
    const recordId = (data as Record<string, unknown>)[idKey];
    try {
      const result = await run({ ctx, input: data });
      return {
        status: result.status ?? 200,
        body: result.body,
        recordIds: typeof recordId === "string" ? { [idKey]: recordId } : undefined,
      };
    } catch (err) {
      // A controlled refusal (not found, ...) is an answer, not a crash.
      if (err instanceof AgentHttpError) {
        return { status: err.status, body: buildErrorBody(err.code, err.message, ctx.correlationId) };
      }
      throw err;
    }
  };
}

export const setDealExecutionStatusExecutor = make(setDealExecutionStatusInputSchema, "dealId", setDealExecutionStatus);
export const updateDealWonValueExecutor = make(updateDealWonValueInputSchema, "dealId", updateDealWonValue);
export const launchBroadcastExecutor = make(launchBroadcastInputSchema, "broadcastId", launchBroadcast);
export const scheduleBroadcastExecutor = make(scheduleBroadcastInputSchema, "broadcastId", scheduleBroadcast);
