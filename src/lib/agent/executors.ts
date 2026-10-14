import type { AgentContext } from "./context";

/**
 * Runs one approved APPROVAL-class request. Each area registry
 * (./registry/<area>.ts) may export EXECUTORS keyed by tool name; the approval
 * runner calls the matching one exactly once, with the stored input.
 */
export type ApprovalExecutorResult = {
  status: number;
  body: unknown;
  /** Ids of the records touched (an array), or a name-to-id map. Ids only, never contents. */
  recordIds?: string[] | Record<string, string>;
};

export type ApprovalExecutor = (args: {
  ctx: AgentContext;
  input: unknown;
  approvalId: string;
  approvedByUserId: string;
}) => Promise<ApprovalExecutorResult>;
