/**
 * The two deal edits the AI may ask for: delivery status and the confirmed
 * project's value, start date and note. Both are APPROVAL tools, so these run
 * when a person has said yes (see executors.ts), and they reuse the exact patch
 * building of the human PATCH /api/deals/[id] (src/lib/crm/dealEdits.ts).
 *
 * The AI never deletes a deal or changes its owner (delete_deal and
 * change_deal_owner are registered NEVER, with no route).
 */
import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { executionStatusPatch, wonDetailsPatch } from "@/lib/crm/dealEdits";
import type { AgentContext } from "../context";
import { AgentHttpError } from "../errors";
import { refusal } from "../messaging/access";
import { toIso, toNumber } from "../read/shared";
import type { setDealExecutionStatusInputSchema, updateDealWonValueInputSchema } from "../schemas/deals";
import type { AgentHandlerResult } from "../withAgent";

type Args<T> = { ctx: AgentContext; input: T };

const DEAL_SELECT = {
  id: true,
  code: true,
  outcome: true,
  deletedAt: true,
  executionStatus: true,
  executionStartedAt: true,
  wonValue: true,
  expectedStartAt: true,
  wonNote: true,
} as const;

type DealRow = {
  id: string;
  code: string;
  outcome: string | null;
  deletedAt: Date | null;
  executionStatus: string | null;
  executionStartedAt: Date | null;
  wonValue: { toString(): string } | null;
  expectedStartAt: Date | null;
  wonNote: string | null;
};

async function loadDeal(dealId: string): Promise<DealRow> {
  const deal = (await prisma.deal.findUnique({ where: { id: dealId }, select: DEAL_SELECT })) as DealRow | null;
  if (!deal || deal.deletedAt) throw new AgentHttpError("not_found", "Deal not found.");
  return deal;
}

function dealBody(d: DealRow, changed: boolean) {
  return {
    deal: {
      id: d.id,
      code: d.code,
      executionStatus: d.executionStatus,
      wonValueInr: toNumber(d.wonValue),
      expectedStartAt: toIso(d.expectedStartAt),
      wonNote: d.wonNote,
    },
    changed,
  };
}

export async function setDealExecutionStatus({
  ctx,
  input,
}: Args<z.infer<typeof setDealExecutionStatusInputSchema>>): Promise<AgentHandlerResult> {
  const deal = await loadDeal(input.dealId);
  // Same rule as the human route: delivery is tracked on confirmed (Won) deals only.
  if (deal.outcome !== "WON") {
    return refusal(ctx, "deal_not_won", "Execution status can only be set on a WON deal.", 422, [deal.id]);
  }
  // Repeating the same status changes nothing (and never moves a completion date).
  if (deal.executionStatus === input.status) {
    return { body: dealBody(deal, false), recordIds: [deal.id], fieldsChanged: [] };
  }
  const patch = executionStatusPatch(deal, input.status);
  const updated = (await prisma.deal.update({ where: { id: deal.id }, data: patch, select: DEAL_SELECT })) as DealRow;
  return { body: dealBody(updated, true), recordIds: [deal.id], fieldsChanged: Object.keys(patch) };
}

export async function updateDealWonValue({
  ctx,
  input,
}: Args<z.infer<typeof updateDealWonValueInputSchema>>): Promise<AgentHandlerResult> {
  const deal = await loadDeal(input.dealId);
  // Same rule as the human route: only a confirmed (Won) deal has a final value, start date and note.
  if (deal.outcome !== "WON") {
    return refusal(ctx, "deal_not_won", "Only a confirmed (Won) deal has a final value, start date and note.", 422, [deal.id]);
  }
  const patch = wonDetailsPatch({
    wonValue: input.wonValue,
    expectedStartAt: input.expectedStartAt,
    wonNote: input.wonNote,
  });

  const same =
    (patch.wonValue === undefined || patch.wonValue === toNumber(deal.wonValue)) &&
    (patch.expectedStartAt === undefined || (patch.expectedStartAt?.getTime() ?? null) === (deal.expectedStartAt?.getTime() ?? null)) &&
    (patch.wonNote === undefined || patch.wonNote === deal.wonNote);
  if (same) return { body: dealBody(deal, false), recordIds: [deal.id], fieldsChanged: [] };

  const updated = (await prisma.deal.update({ where: { id: deal.id }, data: patch, select: DEAL_SELECT })) as DealRow;
  return { body: dealBody(updated, true), recordIds: [deal.id], fieldsChanged: Object.keys(patch) };
}
