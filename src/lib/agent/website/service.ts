/**
 * The AI Sales Agent's website-lead tools that change something. The AI is always
 * the actor (ctx.userId). It sets a stage, adds notes, and can move a lead into
 * the CRM, where the lead is always UNASSIGNED (the same rule as create_lead and
 * move_ad_lead_to_crm). It never assigns a lead to a rep: that is a human's call.
 *
 * Business rules live in src/lib/website-leads/writes.ts (shared with the human
 * routes); this file only decides what the AI is allowed to do with them.
 */
import type { z } from "zod/v4";
import { AgentHttpError } from "../errors";
import type { AgentContext } from "../context";
import type { AgentHandlerResult } from "../withAgent";
import type * as S from "../schemas/website";
import { addWebsiteLeadNote, moveWebsiteLeadToCrm, setWebsiteLeadStage } from "@/lib/website-leads/writes";

type Args<T> = { ctx: AgentContext; input: T };

const notFound = () => new AgentHttpError("not_found", "Website lead not found.");

export async function setStage({ input }: Args<z.infer<typeof S.setWebsiteLeadStageInputSchema>>): Promise<AgentHandlerResult> {
  const result = await setWebsiteLeadStage(input.websiteLeadId, input.stage);
  if (result === "not_found") throw notFound();
  if (result === "invalid_stage") throw new AgentHttpError("invalid_input", "Unknown or inactive stage.");
  return {
    body: { id: input.websiteLeadId, stage: input.stage },
    recordIds: [input.websiteLeadId],
    fieldsChanged: ["stage"],
  };
}

export async function addNote({ ctx, input }: Args<z.infer<typeof S.addWebsiteLeadNoteInputSchema>>): Promise<AgentHandlerResult> {
  const note = await addWebsiteLeadNote({ websiteLeadId: input.websiteLeadId, authorUserId: ctx.userId, body: input.body });
  if (!note) throw notFound();
  return {
    body: { note: { id: note.id, createdAt: note.createdAt.toISOString() } },
    recordIds: [input.websiteLeadId, note.id],
  };
}

export async function moveToCrm({ ctx, input }: Args<z.infer<typeof S.moveWebsiteLeadInputSchema>>): Promise<AgentHandlerResult> {
  // Always unassigned: the AI never picks an owner.
  const result = await moveWebsiteLeadToCrm({
    websiteLeadId: input.websiteLeadId,
    actorUserId: ctx.userId,
    ownerUserId: null,
  });
  if (result.kind === "not_found") throw notFound();
  // Unreachable: no owner is passed, so the owner can never be invalid.
  if (result.kind === "invalid_owner") throw new AgentHttpError("invalid_input", "Owner is not valid.");
  if (result.kind === "already_linked") {
    return {
      body: { accountContactId: result.accountContactId, alreadyLinked: true, matchedExisting: false },
      recordIds: [input.websiteLeadId, ...(result.accountContactId ? [result.accountContactId] : [])],
    };
  }
  return {
    body: { accountContactId: result.accountContactId, alreadyLinked: false, matchedExisting: result.matchedExisting },
    recordIds: [input.websiteLeadId, result.accountContactId],
  };
}
