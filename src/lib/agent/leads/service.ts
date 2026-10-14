/**
 * The AI Sales Agent's lead tools. Each function takes the agent's context and
 * the already-validated input and returns what withAgent should send back; the
 * routes under src/app/api/agent/v1 are thin wrappers around them.
 *
 * The AI is always the actor (ctx.userId): it authors the notes, owns the
 * activities, and is named on every Timeline entry. It never owns a lead, never
 * deletes or merges one, and never takes one from its rep — those are requests
 * a human approves (see LEAD_APPROVAL_EXECUTORS).
 *
 * Business rules live in src/lib/crm and src/lib/meta-ads (shared with the
 * human routes); this file only decides what the AI is allowed to do with them.
 */
import type { Prisma } from "@prisma/client";
import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { parseFields } from "@/lib/contacts";
import { sendPushToUser } from "@/lib/push";
import { findAccountContactDuplicate, findAccountDuplicate } from "@/lib/crm/accounts";
import { reassignCustomerRep } from "@/lib/crm/assignRep";
import { confirmDeal, ConfirmDealError } from "@/lib/crm/confirmDeal";
import { logContactEvent, excerpt } from "@/lib/crm/contactEvents";
import {
  applyContactPatch,
  ContactPatchError,
  PATCH_CONTACT_INCLUDE,
  type ContactPatchInput,
  type ContactPatchOptions,
} from "@/lib/crm/contactPatch";
import {
  addProductInterests,
  createAccountForContact,
  createContactActivity,
  createContactInAccount,
  createContactNote,
  UnknownProductError,
} from "@/lib/crm/contactWrites";
import { firstLeadStage } from "@/lib/crm/leadStages";
import { createNextAction, updateNextAction } from "@/lib/crm/nextActions";
import { createMetaLeadNote, findActiveMetaLeadStage, moveMetaLeadToCrm } from "@/lib/meta-ads/leadWrites";
import type { AgentContext } from "../context";
import { AgentHttpError } from "../errors";
import type { AgentHandlerResult } from "../withAgent";
import type * as S from "../schemas/leads";
import {
  applyFieldPatch,
  canAgentCompleteTask,
  checkDueAt,
  decideDuplicate,
  ESCALATION_DUE_IN_MS,
  ESCALATION_LABEL,
  ESCALATION_REPEAT_WINDOW_MS,
  escalationTaskText,
  findRecentSamePhone,
  isAssignableHuman,
  maskPhone,
  mergeCustomFields,
  NATURAL_KEY_WINDOW_MS,
  parseEscalationTargets,
  pickLeadSourceId,
  requirementPatch,
  resolveEscalationOwner,
  summaryTitle,
  AI_LEAD_SOURCE_SLUGS,
  type DuplicateMatch,
  type EscalationTarget,
} from "./logic";

export const ESCALATION_SETTING_KEY = "agent_escalation_targets";

type Args<T> = { ctx: AgentContext; input: T };

// ── shared pieces ───────────────────────────────────────────────────────────

const LEAD_INCLUDE = {
  account: { select: { ...PATCH_CONTACT_INCLUDE.account.select, deletedAt: true } },
  leadStage: PATCH_CONTACT_INCLUDE.leadStage,
} as const;

type LeadRow = Prisma.AccountContactGetPayload<{ include: typeof LEAD_INCLUDE }>;

const invalid = (message: string, status?: number) => new AgentHttpError("invalid_input", message, status);

/** 409 with the reason in a field the agent can branch on. */
function conflict(ctx: AgentContext, reason: string, message: string, extra: Record<string, unknown> = {}): AgentHandlerResult {
  return {
    status: 409,
    body: { error: { code: "invalid_input", message, correlationId: ctx.correlationId }, reason, ...extra },
  };
}

async function loadLead(id: string): Promise<LeadRow> {
  const lead = await prisma.accountContact.findUnique({ where: { id }, include: LEAD_INCLUDE });
  if (!lead || lead.deletedAt || lead.account.deletedAt) throw new AgentHttpError("not_found", "Lead not found.");
  return lead;
}

export function leadSummary(c: LeadRow) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    designation: c.designation,
    companyName: c.account.name,
    city: c.account.city,
    accountId: c.accountId,
    ownerUserId: c.account.ownerUserId,
    stage: c.leadStageId ? { id: c.leadStageId, name: c.leadStage?.name ?? null } : null,
    isLead: c.pipelineStage === "LEAD",
    createdAt: c.createdAt.toISOString(),
  };
}

/** Names of what the caller sent, never the values (they go to the audit row). */
function sentKeys(input: object, ...skip: string[]): string[] {
  return Object.entries(input)
    .filter(([k, v]) => v !== undefined && !skip.includes(k))
    .map(([k]) => k);
}

async function patchLead(args: {
  ctx: AgentContext;
  before: LeadRow;
  patch: ContactPatchInput;
  options?: ContactPatchOptions;
}) {
  try {
    await applyContactPatch({ before: args.before, input: args.patch, actorUserId: args.ctx.userId, options: args.options });
  } catch (err) {
    if (err instanceof ContactPatchError) throw invalid("That lead stage is not available. Use an active stage id.");
    throw err;
  }
  return loadLead(args.before.id);
}

async function loadAssignableUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, isActive: true, approvalStatus: true, deletedAt: true },
  });
  if (!isAssignableHuman(user)) {
    throw invalid("That user cannot take leads. Pick an active, approved salesperson or manager.", 422);
  }
  return user!;
}

// ── create_lead ─────────────────────────────────────────────────────────────

async function describePerson(id: string): Promise<DuplicateMatch | null> {
  const c = await prisma.accountContact.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      phone: true,
      pipelineStage: true,
      leadStage: { select: { name: true } },
      account: { select: { name: true, ownerUserId: true } },
    },
  });
  if (!c) return null;
  return {
    kind: "person",
    id: c.id,
    name: c.name,
    phoneMasked: maskPhone(c.phone),
    company: c.account.name,
    stage: c.leadStage?.name ?? null,
    isLead: c.pipelineStage === "LEAD",
    ownerAssigned: !!c.account.ownerUserId,
  };
}

async function findDuplicateMatches(args: { name: string; accountName: string; city?: string; phone: string }) {
  const [company, person] = await Promise.all([
    findAccountDuplicate({ name: args.accountName, city: args.city }),
    findAccountContactDuplicate({ phone: args.phone, name: args.name }),
  ]);
  const matches: DuplicateMatch[] = [];
  if (company) matches.push({ kind: "company", id: company.id, name: company.name, city: company.city });
  if (person) {
    const described = await describePerson(person.id);
    if (described) matches.push(described);
  }
  return matches;
}

async function aiLeadSourceId(): Promise<string | null> {
  const rows = await prisma.leadSource.findMany({
    where: { deletedAt: null, isActive: true, slug: { in: [...AI_LEAD_SOURCE_SLUGS] } },
    select: { id: true, slug: true },
  });
  return pickLeadSourceId(rows);
}

export async function createLead({ ctx, input }: Args<z.infer<typeof S.createLeadInputSchema>>): Promise<AgentHandlerResult> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw invalid("phone is not a valid number.");

  // The same number the AI created moments ago is a retry, not a new lead.
  const recent = await prisma.accountContact.findMany({
    where: {
      createdByUserId: ctx.userId,
      deletedAt: null,
      phone: { not: null },
      createdAt: { gte: new Date(Date.now() - NATURAL_KEY_WINDOW_MS) },
    },
    include: LEAD_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const existing = findRecentSamePhone(recent, phone);
  if (existing) {
    return {
      body: { lead: leadSummary(existing), created: false, deduplicated: true },
      action: "dedupe:create",
      recordIds: [existing.id],
    };
  }

  const accountName = input.companyName ?? input.name;
  const matches = await findDuplicateMatches({ name: input.name, accountName, city: input.city, phone });
  const decision = decideDuplicate(matches, input);
  if (decision.action === "conflict") {
    return conflict(
      ctx,
      "possible_duplicate",
      "This may already be in the CRM. Use an existing lead, or call again with confirmNotDuplicate: true and a duplicateReason if it is a different lead.",
      { matches },
    );
  }

  const [leadSourceId, startStage] = await Promise.all([aiLeadSourceId(), firstLeadStage()]);
  // Born unassigned: no rep, no owner. A human (or assign_unassigned_lead) picks one.
  const contact = await prisma.$transaction(async (tx) => {
    const account = await createAccountForContact(
      { name: accountName, city: input.city, businessType: input.businessType, ownerUserId: null },
      tx,
    );
    const created = await createContactInAccount(
      {
        accountId: account.id,
        name: input.name,
        phone,
        email: input.email,
        designation: input.designation,
        notes: input.notes,
        fields: input.customFields,
        isPrimary: true,
        leadSourceId,
        createdByUserId: ctx.userId,
        leadStageId: startStage?.id,
        asLead: true,
      },
      tx,
    );
    return created.contact;
  });

  await logContactEvent({
    contactId: contact.id,
    actorUserId: ctx.userId,
    kind: "lead_added",
    summary: "Lead created by AI Sales Agent",
    detail: decision.confirmedDespite ? `Created despite a possible duplicate. Reason: ${decision.confirmedDespite}` : undefined,
  });

  return {
    body: { lead: leadSummary(await loadLead(contact.id)), created: true, deduplicated: false },
    recordIds: [contact.id],
    fieldsChanged: sentKeys(input),
  };
}

// ── update_lead_details ─────────────────────────────────────────────────────

export async function updateLeadDetails({ ctx, input }: Args<z.infer<typeof S.updateLeadDetailsInputSchema>>): Promise<AgentHandlerResult> {
  const before = await loadLead(input.leadId);
  const patch: ContactPatchInput = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.designation !== undefined) patch.designation = input.designation;
  if (input.email !== undefined) patch.email = input.email;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.city !== undefined) patch.siteCity = input.city;
  if (input.businessType !== undefined) patch.businessType = input.businessType;
  if (input.customerProfileId !== undefined) {
    if (input.customerProfileId) {
      const segment = await prisma.customerProfile.findFirst({
        where: { id: input.customerProfileId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!segment) throw invalid("Unknown customer segment (customerProfileId).");
    }
    patch.customerProfileId = input.customerProfileId;
  }
  if (input.customFields !== undefined) {
    // The human PATCH replaces custom fields; the AI only adds and updates keys.
    const merged = mergeCustomFields(parseFields(before.fields), input.customFields);
    if (!merged.ok) throw invalid(merged.error);
    patch.fields = merged.fields;
  }

  const lead = await patchLead({ ctx, before, patch, options: { detailsSummary: "Details edited by AI Sales Agent" } });
  return {
    body: { lead: leadSummary(lead), changed: true, fieldsChanged: sentKeys(input, "leadId") },
    recordIds: [lead.id],
    fieldsChanged: sentKeys(input, "leadId"),
  };
}

// ── update_lead_phone (needs approval) ──────────────────────────────────────

export async function updateLeadPhone({ ctx, input }: Args<z.infer<typeof S.updateLeadPhoneInputSchema>>): Promise<AgentHandlerResult> {
  const before = await loadLead(input.leadId);
  const next = normalizePhone(input.phone);
  if (!next) throw invalid("phone is not a valid number.");
  if (before.phone && normalizePhone(before.phone) === next) {
    return { body: { lead: leadSummary(before), changed: false }, recordIds: [before.id] };
  }
  const taken = await findAccountContactDuplicate({ phone: next, name: before.name });
  if (taken && taken.id !== before.id) {
    const match = await describePerson(taken.id);
    return conflict(ctx, "phone_in_use", "Another lead already has this number.", { matches: match ? [match] : [] });
  }
  const lead = await patchLead({ ctx, before, patch: { phone: next }, options: { detailsSummary: "Phone changed by AI Sales Agent" } });
  return {
    body: { lead: leadSummary(lead), changed: true, fieldsChanged: ["phone"] },
    recordIds: [lead.id],
    fieldsChanged: ["phone"],
  };
}

// ── set_requirements ────────────────────────────────────────────────────────

async function canonicalSport(name: string): Promise<string> {
  const sports = await prisma.sport.findMany({ where: { isActive: true }, select: { name: true, slug: true } });
  const wanted = name.trim().toLowerCase();
  return sports.find((s) => s.name.toLowerCase() === wanted || s.slug.toLowerCase() === wanted)?.name ?? name;
}

export async function setRequirements({ ctx, input }: Args<z.infer<typeof S.setRequirementsInputSchema>>): Promise<AgentHandlerResult> {
  const before = await loadLead(input.leadId);
  const { leadId: _leadId, ...requirements } = input;
  void _leadId;
  if (requirements.sport) requirements.sport = await canonicalSport(requirements.sport);

  const { fields, changedKeys } = applyFieldPatch(parseFields(before.fields), requirementPatch(requirements));
  if (!changedKeys.length) {
    return { body: { lead: leadSummary(before), changed: false, fieldsChanged: [] }, recordIds: [before.id] };
  }
  const lead = await patchLead({ ctx, before, patch: { fields }, options: { detailsSummary: "Requirements updated by AI Sales Agent" } });
  return {
    body: { lead: leadSummary(lead), changed: true, fieldsChanged: changedKeys },
    recordIds: [lead.id],
    fieldsChanged: changedKeys,
  };
}

// ── set_lead_stage ──────────────────────────────────────────────────────────

export async function setLeadStage({ ctx, input }: Args<z.infer<typeof S.setLeadStageInputSchema>>): Promise<AgentHandlerResult> {
  const before = await loadLead(input.leadId);
  if (before.leadStageId === input.stageId) {
    return { body: { lead: leadSummary(before), changed: false }, recordIds: [before.id] };
  }
  const lead = await patchLead({ ctx, before, patch: { leadStageId: input.stageId } });
  return { body: { lead: leadSummary(lead), changed: true }, recordIds: [lead.id], fieldsChanged: ["leadStageId"] };
}

// ── remove_from_leads (needs approval) ──────────────────────────────────────

export async function removeFromLeads({ ctx, input }: Args<z.infer<typeof S.removeFromLeadsInputSchema>>): Promise<AgentHandlerResult> {
  const before = await loadLead(input.leadId);
  if (before.pipelineStage !== "LEAD") {
    return { body: { lead: leadSummary(before), changed: false }, recordIds: [before.id] };
  }
  const lead = await patchLead({ ctx, before, patch: { pipelineStage: null }, options: { eventDetail: `Reason: ${input.reason}` } });
  return { body: { lead: leadSummary(lead), changed: true }, recordIds: [lead.id], fieldsChanged: ["pipelineStage"] };
}

// ── notes ───────────────────────────────────────────────────────────────────

export async function addNote({ ctx, input }: Args<z.infer<typeof S.addNoteInputSchema>>): Promise<AgentHandlerResult> {
  const lead = await loadLead(input.leadId);
  const note = await createContactNote({ contactId: lead.id, authorUserId: ctx.userId, title: input.title, body: input.body });
  return {
    body: { note: { id: note.id, title: note.title, createdAt: note.createdAt.toISOString() } },
    recordIds: [lead.id, note.id],
  };
}

export async function saveConversationSummary({ ctx, input }: Args<z.infer<typeof S.saveSummaryInputSchema>>): Promise<AgentHandlerResult> {
  const lead = await loadLead(input.leadId);
  const note = await createContactNote({
    contactId: lead.id,
    authorUserId: ctx.userId,
    title: summaryTitle(),
    body: input.summary,
  });
  await logContactEvent({
    contactId: lead.id,
    actorUserId: ctx.userId,
    kind: "ai_summary",
    summary: `AI conversation summary saved — ${excerpt(input.summary)}`,
    refId: note.id,
  });
  return {
    body: { note: { id: note.id, title: note.title, createdAt: note.createdAt.toISOString() } },
    recordIds: [lead.id, note.id],
  };
}

// ── add_product_interest ────────────────────────────────────────────────────

export async function addProductInterest({ ctx, input }: Args<z.infer<typeof S.addProductInterestInputSchema>>): Promise<AgentHandlerResult> {
  const lead = await loadLead(input.leadId);
  try {
    const { added } = await addProductInterests({
      contactId: lead.id,
      productIds: input.productIds,
      otherLabel: input.otherLabel,
      createdByUserId: ctx.userId,
    });
    return { body: { added }, recordIds: [lead.id] };
  } catch (err) {
    if (err instanceof UnknownProductError) throw invalid("One of those product ids is not in the catalogue.");
    throw err;
  }
}

// ── assignment ──────────────────────────────────────────────────────────────

export async function assignUnassignedLead({ ctx, input }: Args<z.infer<typeof S.assignLeadInputSchema>>): Promise<AgentHandlerResult> {
  const lead = await loadLead(input.leadId);
  const alreadyOwned = () =>
    conflict(
      ctx,
      "already_owned",
      "This lead already has an owner and the AI cannot change ownership directly. Use reassign_lead to ask a human to move it.",
      { ownerUserId: lead.account.ownerUserId },
    );
  if (lead.account.ownerUserId) return alreadyOwned();

  const target = await loadAssignableUser(input.userId);
  const result = await reassignCustomerRep({
    accountId: lead.accountId,
    toUserId: target.id,
    actorUserId: ctx.userId,
    onlyIfUnowned: true,
  });
  if (result.skippedOwned) return alreadyOwned();
  return {
    body: { assigned: result.changed, lead: leadSummary(await loadLead(lead.id)) },
    recordIds: [lead.id, lead.accountId],
    fieldsChanged: ["ownerUserId"],
  };
}

export async function reassignLead({ ctx, input }: Args<z.infer<typeof S.reassignLeadInputSchema>>): Promise<AgentHandlerResult> {
  const lead = await loadLead(input.leadId);
  const target = await loadAssignableUser(input.userId);
  const result = await reassignCustomerRep({ accountId: lead.accountId, toUserId: target.id, actorUserId: ctx.userId });
  return {
    body: { assigned: result.changed, lead: leadSummary(await loadLead(lead.id)) },
    recordIds: [lead.id, lead.accountId],
    fieldsChanged: ["ownerUserId"],
  };
}

// ── escalation and follow-ups ───────────────────────────────────────────────

/** The human an escalation to `target` goes to: configured, else the lead's rep, else an admin. */
async function resolveEscalationUser(target: EscalationTarget, repId: string | null) {
  const setting = await prisma.setting.findUnique({ where: { key: ESCALATION_SETTING_KEY } });
  const configuredIds = parseEscalationTargets(setting?.value)[target];
  const admins = await prisma.user.findMany({
    where: { role: "admin", isActive: true, deletedAt: null, approvalStatus: "approved" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
    take: 5,
  });
  const adminIds = admins.map((a) => a.id);
  const candidates = Array.from(new Set([...configuredIds, ...(repId ? [repId] : []), ...adminIds]));
  const users = await prisma.user.findMany({
    where: { id: { in: candidates }, isActive: true, deletedAt: null, approvalStatus: "approved", role: { not: "ai_agent" } },
    select: { id: true, name: true, pushEnabled: true },
  });
  const owner = resolveEscalationOwner({
    configuredIds,
    repId,
    adminIds,
    eligible: new Set(users.map((u) => u.id)),
  });
  const user = owner ? users.find((u) => u.id === owner.userId) : undefined;
  return owner && user ? { user, source: owner.source } : null;
}

const NO_TARGET =
  "No one is configured for this and there is no active admin to fall back to. An admin must set the agent_escalation_targets setting.";

export async function escalateLead({ ctx, input }: Args<z.infer<typeof S.escalateLeadInputSchema>>): Promise<AgentHandlerResult> {
  const lead = await loadLead(input.leadId);
  const owner = await resolveEscalationUser(input.target, lead.account.ownerUserId);
  if (!owner) return conflict(ctx, "no_escalation_target", NO_TARGET);
  const assignedTo = { userId: owner.user.id, name: owner.user.name };

  // Escalating the same lead to the same place again within the hour is a repeat.
  const label = ESCALATION_LABEL[input.target];
  const open = await prisma.contactNextAction.findFirst({
    where: {
      accountContactId: lead.id,
      createdByUserId: ctx.userId,
      deletedAt: null,
      doneAt: null,
      createdAt: { gte: new Date(Date.now() - ESCALATION_REPEAT_WINDOW_MS) },
      text: { startsWith: `Escalated to ${label}:` },
    },
    select: { id: true },
  });
  if (open) {
    return {
      body: { escalated: true, deduplicated: true, taskId: open.id, assignedTo, source: owner.source },
      action: "dedupe:create",
      recordIds: [lead.id, open.id],
    };
  }

  const task = await createNextAction({
    contactId: lead.id,
    text: escalationTaskText(input.target, input.reason),
    dueAt: new Date(Date.now() + ESCALATION_DUE_IN_MS),
    createdByUserId: ctx.userId,
    reminder: { ownerUserId: owner.user.id, priority: "HIGH" },
  });
  await logContactEvent({
    contactId: lead.id,
    actorUserId: ctx.userId,
    kind: "escalated",
    summary: `Escalated to ${label} — ${owner.user.name}`,
    detail: `Reason: ${input.reason}\n\n${input.summary}`,
    refId: task.id,
  });
  if (owner.user.pushEnabled) {
    try {
      await sendPushToUser(owner.user.id, {
        title: "Lead escalated to you",
        body: `${lead.name}: ${input.reason}`.slice(0, 140),
        url: `/crm/contacts/${lead.id}`,
        tag: `escalation-${lead.id}`,
      });
    } catch {
      // Best effort: the follow-up and its reminder already exist.
    }
  }
  return {
    body: { escalated: true, deduplicated: false, taskId: task.id, assignedTo, source: owner.source },
    recordIds: [lead.id, task.id],
  };
}

export async function createFollowupTask({ ctx, input }: Args<z.infer<typeof S.createFollowupInputSchema>>): Promise<AgentHandlerResult> {
  const problem = checkDueAt(input.dueAt);
  if (problem) throw invalid(problem);
  const lead = await loadLead(input.leadId);

  // The reminder goes to the lead's rep; with no rep, to whoever an escalation
  // to a manager would reach. Never to the AI itself.
  let remindUserId = lead.account.ownerUserId;
  if (!remindUserId) {
    const fallback = await resolveEscalationUser("manager", null);
    if (!fallback) return conflict(ctx, "no_escalation_target", NO_TARGET);
    remindUserId = fallback.user.id;
  }
  const task = await createNextAction({
    contactId: lead.id,
    text: input.text,
    dueAt: new Date(input.dueAt),
    createdByUserId: ctx.userId,
    reminder: { ownerUserId: remindUserId },
  });
  return {
    body: {
      task: { id: task.id, text: task.text, dueAt: task.dueAt?.toISOString() ?? null, done: false, remindUserId },
    },
    recordIds: [lead.id, task.id],
  };
}

export async function completeTask({ ctx, input }: Args<z.infer<typeof S.completeTaskInputSchema>>): Promise<AgentHandlerResult> {
  const task = await prisma.contactNextAction.findUnique({
    where: { id: input.taskId },
    include: { accountContact: { select: { deletedAt: true } } },
  });
  if (!task || task.deletedAt || task.accountContact.deletedAt) throw new AgentHttpError("not_found", "Task not found.");
  if (!canAgentCompleteTask(task, ctx.userId)) {
    throw new AgentHttpError(
      "forbidden",
      "The AI can only complete tasks it created itself. This task belongs to a human; ask them to complete it.",
    );
  }
  const updated = await updateNextAction({ before: task, patch: { done: input.done }, actorUserId: ctx.userId });
  return {
    body: {
      task: { id: updated.id, text: updated.text, dueAt: updated.dueAt?.toISOString() ?? null, done: !!updated.doneAt },
    },
    recordIds: [updated.accountContactId, updated.id],
    fieldsChanged: ["done"],
  };
}

// ── log_activity ────────────────────────────────────────────────────────────

export async function logActivity({ ctx, input }: Args<z.infer<typeof S.logActivityInputSchema>>): Promise<AgentHandlerResult> {
  const lead = await loadLead(input.leadId);
  const type = await prisma.activityType.findFirst({
    where: { id: input.activityTypeId, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (!type) throw invalid("Unknown or inactive activityTypeId.");
  const activity = await createContactActivity({
    contact: { id: lead.id, accountId: lead.accountId },
    activityTypeId: type.id,
    ownerUserId: ctx.userId,
    subject: input.subject,
    notes: input.notes,
    durationMins: input.durationMins,
    outcome: input.outcome,
  });
  return {
    body: { activity: { id: activity.id, occurredAt: activity.occurredAt.toISOString() } },
    recordIds: [lead.id, activity.id],
  };
}

// ── ad leads ────────────────────────────────────────────────────────────────

async function requireAdLead(id: string) {
  const lead = await prisma.metaLead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) throw new AgentHttpError("not_found", "Ad lead not found.");
  return lead;
}

export async function setAdLeadStage({ input }: Args<z.infer<typeof S.setAdLeadStageInputSchema>>): Promise<AgentHandlerResult> {
  const lead = await requireAdLead(input.adLeadId);
  const stage = await findActiveMetaLeadStage(input.stage);
  if (!stage) throw invalid("Unknown or inactive stage.");
  await prisma.metaLead.update({ where: { id: lead.id }, data: { stage: stage.slug } });
  return { body: { id: lead.id, stage: stage.slug }, recordIds: [lead.id], fieldsChanged: ["stage"] };
}

export async function addAdLeadNote({ ctx, input }: Args<z.infer<typeof S.addAdLeadNoteInputSchema>>): Promise<AgentHandlerResult> {
  const lead = await requireAdLead(input.adLeadId);
  const note = await createMetaLeadNote({ metaLeadId: lead.id, authorUserId: ctx.userId, body: input.body });
  return { body: { note: { id: note.id, createdAt: note.createdAt.toISOString() } }, recordIds: [lead.id, note.id] };
}

export async function moveAdLeadToCrm({ ctx, input }: Args<z.infer<typeof S.moveAdLeadInputSchema>>): Promise<AgentHandlerResult> {
  // Always unassigned: the AI never picks an owner.
  const result = await moveMetaLeadToCrm({ metaLeadId: input.adLeadId, actorUserId: ctx.userId, ownerUserId: null });
  if (result.kind === "not_found") throw new AgentHttpError("not_found", "Ad lead not found.");
  if (result.kind === "invalid_owner") throw invalid("Owner is not valid."); // unreachable: no owner is passed
  if (result.kind === "already_linked") {
    return {
      body: { accountContactId: result.accountContactId, alreadyLinked: true, matchedExisting: false },
      recordIds: [input.adLeadId, ...(result.accountContactId ? [result.accountContactId] : [])],
    };
  }
  return {
    body: { accountContactId: result.accountContactId, alreadyLinked: false, matchedExisting: result.matchedExisting },
    recordIds: [input.adLeadId, result.accountContactId],
  };
}

// ── requests that wait for a human ──────────────────────────────────────────

/** Records the intent only. The AI never merges leads; a human does it from the CRM. */
export async function requestMerge({ input }: Args<z.infer<typeof S.requestMergeInputSchema>>): Promise<AgentHandlerResult> {
  const ids = [input.primaryLeadId, ...input.duplicateLeadIds];
  const found = await prisma.accountContact.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
  if (found.length !== ids.length) throw new AgentHttpError("not_found", "One or more of those leads were not found.");
  return { body: { recorded: true }, recordIds: ids };
}

export async function requestMarkWon({ ctx, input }: Args<z.infer<typeof S.requestMarkWonInputSchema>>): Promise<AgentHandlerResult> {
  const lead = await loadLead(input.leadId);
  // confirmDeal makes the account owner the deal's owner; with none it would
  // fall back to the actor, i.e. the AI. A deal must belong to a person.
  if (!lead.account.ownerUserId) {
    return conflict(ctx, "unassigned", "Assign this lead to a salesperson before marking it won, so the deal has a human owner.");
  }
  try {
    const deal = await confirmDeal({
      contactId: lead.id,
      value: input.value,
      expectedStartAt: input.expectedStartAt ? new Date(input.expectedStartAt) : null,
      note: input.note || null,
      actorUserId: ctx.userId,
    });
    return { body: { deal: { id: deal.id, code: deal.code } }, recordIds: [lead.id, deal.id] };
  } catch (err) {
    if (err instanceof ConfirmDealError) throw new AgentHttpError("invalid_input", err.message, err.status);
    throw err;
  }
}

/**
 * What runs when a person approves one of the AI's requests: the same handlers,
 * with the stored input. They are never reachable through the routes while the
 * tools' verdict is APPROVAL (withAgent queues the request instead).
 */
export const LEAD_APPROVAL_EXECUTORS = {
  update_lead_phone: updateLeadPhone,
  remove_from_leads: removeFromLeads,
  reassign_lead: reassignLead,
  request_merge: requestMerge,
  request_mark_won: requestMarkWon,
} as const;
