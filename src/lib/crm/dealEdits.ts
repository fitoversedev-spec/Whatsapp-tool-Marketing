// The pieces of a deal edit that both the human route (PATCH /api/deals/[id])
// and the AI agent's approved requests use, so the two cannot drift apart.

export type ExecutionStatus = "IN_EXECUTION" | "COMPLETED";

// Post-won delivery tracking. The timestamps are stamped here, never taken from
// a client, and an existing start time is never pushed forward.
export function executionStatusPatch(
  deal: { executionStartedAt: Date | null },
  status: ExecutionStatus,
): { executionStatus: ExecutionStatus; executionStartedAt?: Date; deliveryCompletedAt?: Date } {
  const patch: { executionStatus: ExecutionStatus; executionStartedAt?: Date; deliveryCompletedAt?: Date } = {
    executionStatus: status,
  };
  if (status === "IN_EXECUTION" && !deal.executionStartedAt) patch.executionStartedAt = new Date();
  if (status === "COMPLETED") {
    patch.deliveryCompletedAt = new Date();
    if (!deal.executionStartedAt) patch.executionStartedAt = new Date();
  }
  return patch;
}

// The confirmed project's details (set at Won, correctable afterwards): only the
// fields that were sent are written. A blank note clears it.
export function wonDetailsPatch(input: {
  wonValue?: number;
  expectedStartAt?: string | null;
  wonNote?: string | null;
}): { wonValue?: number; expectedStartAt?: Date | null; wonNote?: string | null } {
  const patch: { wonValue?: number; expectedStartAt?: Date | null; wonNote?: string | null } = {};
  if (input.wonValue !== undefined) patch.wonValue = input.wonValue;
  if (input.expectedStartAt !== undefined) {
    patch.expectedStartAt = input.expectedStartAt ? new Date(input.expectedStartAt) : null;
  }
  if (input.wonNote !== undefined) patch.wonNote = input.wonNote || null;
  return patch;
}
