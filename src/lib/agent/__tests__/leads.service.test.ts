import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  accountContact: { findUnique: vi.fn(), findMany: vi.fn() },
  contactNextAction: { findUnique: vi.fn(), findFirst: vi.fn() },
  leadSource: { findMany: vi.fn() },
  setting: { findUnique: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  customerProfile: { findFirst: vi.fn() },
  sport: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }));

const m = vi.hoisted(() => ({
  reassignCustomerRep: vi.fn(),
  confirmDeal: vi.fn(),
  logContactEvent: vi.fn(),
  applyContactPatch: vi.fn(),
  createAccountForContact: vi.fn(),
  createContactInAccount: vi.fn(),
  createContactNote: vi.fn(),
  createNextAction: vi.fn(),
  updateNextAction: vi.fn(),
  findAccountDuplicate: vi.fn(),
  findAccountContactDuplicate: vi.fn(),
  firstLeadStage: vi.fn(),
}));
vi.mock("@/lib/crm/assignRep", () => ({ reassignCustomerRep: m.reassignCustomerRep }));
vi.mock("@/lib/crm/confirmDeal", () => ({
  confirmDeal: m.confirmDeal,
  ConfirmDealError: class ConfirmDealError extends Error {},
}));
vi.mock("@/lib/crm/contactEvents", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crm/contactEvents")>("@/lib/crm/contactEvents");
  return { ...actual, logContactEvent: m.logContactEvent };
});
vi.mock("@/lib/crm/contactPatch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crm/contactPatch")>("@/lib/crm/contactPatch");
  return { ...actual, applyContactPatch: m.applyContactPatch };
});
vi.mock("@/lib/crm/contactWrites", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crm/contactWrites")>("@/lib/crm/contactWrites");
  return {
    ...actual,
    createAccountForContact: m.createAccountForContact,
    createContactInAccount: m.createContactInAccount,
    createContactNote: m.createContactNote,
  };
});
vi.mock("@/lib/crm/nextActions", () => ({ createNextAction: m.createNextAction, updateNextAction: m.updateNextAction }));
vi.mock("@/lib/crm/accounts", () => ({
  findAccountDuplicate: m.findAccountDuplicate,
  findAccountContactDuplicate: m.findAccountContactDuplicate,
}));
vi.mock("@/lib/crm/leadStages", () => ({ firstLeadStage: m.firstLeadStage }));

import { sendPushToUser } from "@/lib/push";
import { AgentHttpError } from "../errors";
import * as svc from "../leads/service";
import type { AgentContext } from "../context";

const AI = "ai-user";
const ctx: AgentContext = {
  identityId: "idn",
  userId: AI,
  credentialId: "cred",
  environment: "staging",
  correlationId: "corr-0001",
  ip: null,
};
const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function lead(over: Record<string, unknown> = {}, owner: string | null = null) {
  return {
    id: ID,
    accountId: "acc-1",
    name: "Ravi",
    phone: "919876543210",
    email: null,
    designation: null,
    fields: "{}",
    notes: null,
    leadStageId: null,
    pipelineStage: "LEAD",
    leadSourceId: null,
    promotedToLeadAt: null,
    isPrimary: true,
    createdAt: new Date(),
    deletedAt: null,
    leadStage: null,
    account: { id: "acc-1", name: "Ravi", city: null, ownerUserId: owner, customerProfileId: null, businessType: null, deletedAt: null },
    ...over,
  };
}

beforeEach(() => {
  for (const group of [db.accountContact, db.contactNextAction, db.leadSource, db.setting, db.user, db.customerProfile, db.sport]) {
    for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  db.$transaction.mockReset();
  for (const fn of Object.values(m)) fn.mockReset();
  vi.mocked(sendPushToUser).mockClear();
  db.$transaction.mockImplementation(async (cb: (tx: object) => unknown) => cb({}));
  db.accountContact.findMany.mockResolvedValue([]);
  db.leadSource.findMany.mockResolvedValue([{ id: "src-ai", slug: "ai_sales_agent" }]);
  db.sport.findMany.mockResolvedValue([]);
  m.firstLeadStage.mockResolvedValue({ id: "stage-1", name: "Lead Generation" });
  m.findAccountDuplicate.mockResolvedValue(null);
  m.findAccountContactDuplicate.mockResolvedValue(null);
  m.createAccountForContact.mockResolvedValue({ id: "acc-new" });
  m.createContactInAccount.mockResolvedValue({ contact: { id: "new-lead" } });
  m.createNextAction.mockImplementation(async (a: { text: string }) => ({ id: "task-1", text: a.text, dueAt: new Date() }));
  m.applyContactPatch.mockResolvedValue({});
});

describe("create_lead", () => {
  const input = { name: "Ravi Kumar", phone: "+91 98765 43210" };

  function mockLoadAfterCreate() {
    db.accountContact.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "new-lead" ? lead({ id: "new-lead", createdByUserId: AI }) : null,
    );
  }

  it("creates an UNASSIGNED lead, as the AI, in the first stage, with a normalised phone", async () => {
    mockLoadAfterCreate();
    const res = await svc.createLead({ ctx, input });
    expect(res.body).toMatchObject({ created: true, deduplicated: false });
    expect(m.createAccountForContact.mock.calls[0][0]).toMatchObject({ ownerUserId: null, name: "Ravi Kumar" });
    expect(m.createContactInAccount.mock.calls[0][0]).toMatchObject({
      phone: "919876543210",
      createdByUserId: AI,
      leadStageId: "stage-1",
      leadSourceId: "src-ai",
      asLead: true,
    });
    expect(m.logContactEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "lead_added", actorUserId: AI }));
  });

  it("returns 409 with the matches, and creates nothing, on a possible duplicate", async () => {
    m.findAccountContactDuplicate.mockResolvedValue({ id: "c9", name: "Ravi", phone: "919876543210", accountId: "a9" });
    db.accountContact.findUnique.mockResolvedValue({
      id: "c9", name: "Ravi", phone: "919876543210", pipelineStage: "LEAD", leadStage: { name: "Qualified" }, account: { name: "Ravi", ownerUserId: "rep" },
    });
    const res = await svc.createLead({ ctx, input });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: "possible_duplicate" });
    const matches = (res.body as { matches: { phoneMasked: string; ownerAssigned: boolean }[] }).matches;
    expect(matches[0]).toMatchObject({ kind: "person", phoneMasked: "********3210", ownerAssigned: true });
    expect(JSON.stringify(res.body)).not.toContain("919876543210");
    expect(m.createContactInAccount).not.toHaveBeenCalled();
    expect(m.createAccountForContact).not.toHaveBeenCalled();
  });

  it("a company-name match is a duplicate too", async () => {
    m.findAccountDuplicate.mockResolvedValue({ id: "a1", name: "Ravi Kumar", city: null });
    const res = await svc.createLead({ ctx, input });
    expect(res.status).toBe(409);
    expect(m.createContactInAccount).not.toHaveBeenCalled();
  });

  it("goes ahead with confirmNotDuplicate + reason, and records the reason on the timeline", async () => {
    m.findAccountContactDuplicate.mockResolvedValue({ id: "c9", name: "Ravi", phone: "919876543210", accountId: "a9" });
    db.accountContact.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "new-lead"
        ? lead({ id: "new-lead" })
        : { id: "c9", name: "Ravi", phone: "919876543210", pipelineStage: null, leadStage: null, account: { name: "Ravi", ownerUserId: null } },
    );
    const res = await svc.createLead({ ctx, input: { ...input, confirmNotDuplicate: true, duplicateReason: "His brother, same shop" } });
    expect(res.body).toMatchObject({ created: true });
    expect(m.logContactEvent.mock.calls[0][0].detail).toContain("His brother, same shop");
  });

  it("the same phone created by the AI minutes ago returns that lead and creates nothing", async () => {
    const recent = lead({ id: "earlier", phone: "919876543210", createdAt: new Date(Date.now() - 3 * 60_000) });
    db.accountContact.findMany.mockResolvedValue([recent]);
    const res = await svc.createLead({ ctx, input });
    expect(res.body).toMatchObject({ created: false, deduplicated: true, lead: { id: "earlier" } });
    expect(res.status).toBeUndefined();
    expect(m.createContactInAccount).not.toHaveBeenCalled();
    expect(m.findAccountDuplicate).not.toHaveBeenCalled();
    // only the AI's own recent creations are considered
    expect(db.accountContact.findMany.mock.calls[0][0].where).toMatchObject({ createdByUserId: AI });
  });
});

describe("update_lead_details merges custom fields", () => {
  it("passes the union of old and new keys to the shared patch", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead({ fields: JSON.stringify({ Source: "Instagram", Floor: "wood" }) }));
    await svc.updateLeadDetails({ ctx, input: { leadId: ID, customFields: { Floor: "acrylic" } } });
    const call = m.applyContactPatch.mock.calls[0][0];
    expect(call.input.fields).toEqual({ Source: "Instagram", Floor: "acrylic" });
    expect(call.actorUserId).toBe(AI);
    expect(call.input).not.toHaveProperty("phone");
  });

  it("refuses a custom field that would grow the lead past the cap", async () => {
    const full = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, "v"]));
    db.accountContact.findUnique.mockResolvedValue(lead({ fields: JSON.stringify(full) }));
    await expect(svc.updateLeadDetails({ ctx, input: { leadId: ID, customFields: { extra: "v" } } })).rejects.toBeInstanceOf(AgentHttpError);
    expect(m.applyContactPatch).not.toHaveBeenCalled();
  });
});

describe("set_requirements", () => {
  it("merges agent.* keys and keeps every other custom field", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead({ fields: JSON.stringify({ Source: "Instagram", "agent.city": "Pune" }) }));
    db.sport.findMany.mockResolvedValue([{ name: "Badminton", slug: "badminton" }]);
    const res = await svc.setRequirements({ ctx, input: { leadId: ID, sport: "badminton", budgetInr: 450000 } });
    expect(m.applyContactPatch.mock.calls[0][0].input.fields).toEqual({
      Source: "Instagram",
      "agent.city": "Pune",
      "agent.sport": "Badminton",
      "agent.budgetInr": "450000",
    });
    expect((res.body as { fieldsChanged: string[] }).fieldsChanged.sort()).toEqual(["agent.budgetInr", "agent.sport"]);
  });

  it("writes nothing when nothing changed", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead({ fields: JSON.stringify({ "agent.sport": "Tennis" }) }));
    const res = await svc.setRequirements({ ctx, input: { leadId: ID, sport: "Tennis" } });
    expect(res.body).toMatchObject({ changed: false });
    expect(m.applyContactPatch).not.toHaveBeenCalled();
  });
});

describe("assign_unassigned_lead", () => {
  const rep = { id: "rep-1", name: "Asha", role: "sales", isActive: true, approvalStatus: "approved", deletedAt: null };

  it("assigns a lead nobody owns, and only if it is still unowned", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead());
    db.user.findUnique.mockResolvedValue(rep);
    m.reassignCustomerRep.mockResolvedValue({ changed: true });
    const res = await svc.assignUnassignedLead({ ctx, input: { leadId: ID, userId: "rep-1" } });
    expect(res.body).toMatchObject({ assigned: true });
    expect(m.reassignCustomerRep).toHaveBeenCalledWith({ accountId: "acc-1", toUserId: "rep-1", actorUserId: AI, onlyIfUnowned: true });
  });

  it("an owned lead is a 409 that points at reassign_lead, and nothing is changed", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead({}, "someone"));
    const res = await svc.assignUnassignedLead({ ctx, input: { leadId: ID, userId: "rep-1" } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: "already_owned" });
    expect(JSON.stringify(res.body)).toContain("reassign_lead");
    expect(m.reassignCustomerRep).not.toHaveBeenCalled();
  });

  it("loses gracefully when someone assigns it between the check and the write", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead());
    db.user.findUnique.mockResolvedValue(rep);
    m.reassignCustomerRep.mockResolvedValue({ changed: false, skippedOwned: true });
    const res = await svc.assignUnassignedLead({ ctx, input: { leadId: ID, userId: "rep-1" } });
    expect(res.status).toBe(409);
  });

  it("the target must be an active, approved salesperson or manager", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead());
    for (const bad of [
      { ...rep, role: "admin" },
      { ...rep, role: "ai_agent" },
      { ...rep, isActive: false },
      { ...rep, approvalStatus: "pending" },
      { ...rep, deletedAt: new Date() },
      null,
    ]) {
      db.user.findUnique.mockResolvedValueOnce(bad);
      await expect(svc.assignUnassignedLead({ ctx, input: { leadId: ID, userId: "x" } })).rejects.toBeInstanceOf(AgentHttpError);
    }
    expect(m.reassignCustomerRep).not.toHaveBeenCalled();
  });
});

describe("complete_task: only tasks the AI created", () => {
  const task = (createdByUserId: string) => ({
    id: "t1", accountContactId: ID, text: "Call", dueAt: null, doneAt: null, deletedAt: null, createdByUserId, accountContact: { deletedAt: null },
  });

  it("refuses a human's task with a 403 and a clear message", async () => {
    db.contactNextAction.findUnique.mockResolvedValue(task("rep-1"));
    const err = await svc.completeTask({ ctx, input: { taskId: "t1", done: true } }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentHttpError);
    expect(err).toMatchObject({ code: "forbidden", status: 403 });
    expect(err.message).toMatch(/only complete tasks it created/);
    expect(m.updateNextAction).not.toHaveBeenCalled();
  });

  it("completes a task it created, recording the AI as who did it", async () => {
    db.contactNextAction.findUnique.mockResolvedValue(task(AI));
    m.updateNextAction.mockResolvedValue({ ...task(AI), doneAt: new Date() });
    const res = await svc.completeTask({ ctx, input: { taskId: "t1", done: true } });
    expect(res.body).toMatchObject({ task: { id: "t1", done: true } });
    expect(m.updateNextAction.mock.calls[0][0]).toMatchObject({ patch: { done: true }, actorUserId: AI });
  });

  it("a missing or deleted task is a 404", async () => {
    db.contactNextAction.findUnique.mockResolvedValueOnce(null);
    await expect(svc.completeTask({ ctx, input: { taskId: "t1", done: true } })).rejects.toMatchObject({ status: 404 });
    db.contactNextAction.findUnique.mockResolvedValueOnce({ ...task(AI), deletedAt: new Date() });
    await expect(svc.completeTask({ ctx, input: { taskId: "t1", done: true } })).rejects.toMatchObject({ status: 404 });
  });
});

describe("escalate_lead", () => {
  const human = (id: string, name = id) => ({ id, name, pushEnabled: true });

  function setup(opts: { config?: object | null; owner?: string | null; eligible: string[]; admins?: string[] }) {
    db.accountContact.findUnique.mockResolvedValue(lead({}, opts.owner ?? null));
    db.setting.findUnique.mockResolvedValue(opts.config ? { value: JSON.stringify(opts.config) } : null);
    db.user.findMany.mockImplementation(async ({ where }: { where: { role?: string; id?: { in: string[] } } }) =>
      where.role === "admin"
        ? (opts.admins ?? []).map((id) => ({ id }))
        : opts.eligible.filter((id) => where.id!.in.includes(id)).map((id) => human(id)),
    );
    db.contactNextAction.findFirst.mockResolvedValue(null);
  }
  const input = { leadId: ID, target: "civil_engineer" as const, reason: "Needs a site survey", summary: "44x20 court, wants PU." };

  it("goes to the configured person: high-priority follow-up for them, push, timeline entry", async () => {
    setup({ config: { civil_engineer: ["eng-1"] }, owner: "rep-1", eligible: ["eng-1", "rep-1"] });
    const res = await svc.escalateLead({ ctx, input });
    expect(res.body).toMatchObject({ escalated: true, deduplicated: false, assignedTo: { userId: "eng-1" }, source: "configured" });
    const task = m.createNextAction.mock.calls[0][0];
    expect(task.reminder).toEqual({ ownerUserId: "eng-1", priority: "HIGH" });
    expect(task.createdByUserId).toBe(AI);
    expect(task.dueAt.getTime()).toBeGreaterThan(Date.now());
    expect(m.logContactEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "escalated", actorUserId: AI, refId: "task-1" }));
    expect(sendPushToUser).toHaveBeenCalledWith("eng-1", expect.objectContaining({ url: `/crm/contacts/${ID}` }));
  });

  it("an unconfigured target falls back to the lead's rep, then to an admin", async () => {
    setup({ config: null, owner: "rep-1", eligible: ["rep-1", "adm-1"], admins: ["adm-1"] });
    expect((await svc.escalateLead({ ctx, input })).body).toMatchObject({ assignedTo: { userId: "rep-1" }, source: "rep" });

    m.createNextAction.mockClear();
    setup({ config: null, owner: null, eligible: ["adm-1"], admins: ["adm-1"] });
    expect((await svc.escalateLead({ ctx, input })).body).toMatchObject({ assignedTo: { userId: "adm-1" }, source: "admin" });
    expect(m.createNextAction.mock.calls[0][0].reminder.ownerUserId).toBe("adm-1");
  });

  it("an ineligible configured person is skipped", async () => {
    setup({ config: { civil_engineer: ["left-company"] }, owner: "rep-1", eligible: ["rep-1"] });
    expect((await svc.escalateLead({ ctx, input })).body).toMatchObject({ assignedTo: { userId: "rep-1" }, source: "rep" });
  });

  it("with nobody to escalate to, it says so and creates nothing", async () => {
    setup({ config: null, owner: null, eligible: [], admins: [] });
    const res = await svc.escalateLead({ ctx, input });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: "no_escalation_target" });
    expect(m.createNextAction).not.toHaveBeenCalled();
  });

  it("the same escalation again within the hour reuses the open follow-up", async () => {
    setup({ config: { civil_engineer: ["eng-1"] }, owner: null, eligible: ["eng-1"] });
    db.contactNextAction.findFirst.mockResolvedValue({ id: "task-open" });
    const res = await svc.escalateLead({ ctx, input });
    expect(res.body).toMatchObject({ deduplicated: true, taskId: "task-open" });
    expect(m.createNextAction).not.toHaveBeenCalled();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("a failing push does not fail the escalation", async () => {
    setup({ config: { civil_engineer: ["eng-1"] }, owner: null, eligible: ["eng-1"] });
    vi.mocked(sendPushToUser).mockRejectedValueOnce(new Error("push down"));
    await expect(svc.escalateLead({ ctx, input })).resolves.toMatchObject({ body: { escalated: true } });
  });
});

describe("create_followup_task: the reminder never belongs to the AI", () => {
  const future = new Date(Date.now() + 2 * 86_400_000).toISOString();

  it("goes to the lead's rep", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead({}, "rep-1"));
    const res = await svc.createFollowupTask({ ctx, input: { leadId: ID, text: "Call back", dueAt: future } });
    expect(m.createNextAction.mock.calls[0][0]).toMatchObject({ createdByUserId: AI, reminder: { ownerUserId: "rep-1" } });
    expect(res.body).toMatchObject({ task: { remindUserId: "rep-1" } });
  });

  it("with no rep, goes to the fallback human", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead());
    db.setting.findUnique.mockResolvedValue(null);
    db.user.findMany.mockImplementation(async ({ where }: { where: { role?: string } }) =>
      where.role === "admin" ? [{ id: "adm-1" }] : [{ id: "adm-1", name: "Owner", pushEnabled: false }],
    );
    await svc.createFollowupTask({ ctx, input: { leadId: ID, text: "Call back", dueAt: future } });
    expect(m.createNextAction.mock.calls[0][0].reminder.ownerUserId).toBe("adm-1");
    expect(m.createNextAction.mock.calls[0][0].reminder.ownerUserId).not.toBe(AI);
  });

  it("with no rep and no human to fall back to, it creates nothing", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead());
    db.setting.findUnique.mockResolvedValue(null);
    db.user.findMany.mockResolvedValue([]);
    const res = await svc.createFollowupTask({ ctx, input: { leadId: ID, text: "Call back", dueAt: future } });
    expect(res.status).toBe(409);
    expect(m.createNextAction).not.toHaveBeenCalled();
  });

  it("re-checks the date (an approval could run it later)", async () => {
    await expect(
      svc.createFollowupTask({ ctx, input: { leadId: ID, text: "x", dueAt: new Date(Date.now() - 1000).toISOString() } }),
    ).rejects.toBeInstanceOf(AgentHttpError);
  });
});

describe("stage, removal and won requests", () => {
  it("set_lead_stage uses the shared stage validation and does nothing when the stage is unchanged", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead({ leadStageId: "s1" }));
    expect((await svc.setLeadStage({ ctx, input: { leadId: ID, stageId: "s1" } })).body).toMatchObject({ changed: false });
    expect(m.applyContactPatch).not.toHaveBeenCalled();
    await svc.setLeadStage({ ctx, input: { leadId: ID, stageId: "s2" } });
    expect(m.applyContactPatch.mock.calls[0][0]).toMatchObject({ input: { leadStageId: "s2" }, actorUserId: AI });
  });

  it("an unavailable stage is a 400, not a 500", async () => {
    const { ContactPatchError } = await import("@/lib/crm/contactPatch");
    db.accountContact.findUnique.mockResolvedValue(lead());
    m.applyContactPatch.mockRejectedValueOnce(new ContactPatchError("Stage not available", 422));
    await expect(svc.setLeadStage({ ctx, input: { leadId: ID, stageId: "gone" } })).rejects.toMatchObject({ code: "invalid_input", status: 400 });
  });

  it("remove_from_leads only acts on a current lead", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead({ pipelineStage: null }));
    expect((await svc.removeFromLeads({ ctx, input: { leadId: ID, reason: "Not a buyer" } })).body).toMatchObject({ changed: false });
    expect(m.applyContactPatch).not.toHaveBeenCalled();
    db.accountContact.findUnique.mockResolvedValue(lead());
    await svc.removeFromLeads({ ctx, input: { leadId: ID, reason: "Not a buyer" } });
    expect(m.applyContactPatch.mock.calls[0][0]).toMatchObject({ input: { pipelineStage: null }, options: { eventDetail: "Reason: Not a buyer" } });
  });

  it("request_mark_won will not create a deal owned by the AI", async () => {
    db.accountContact.findUnique.mockResolvedValue(lead());
    const res = await svc.requestMarkWon({ ctx, input: { leadId: ID, value: 500000 } });
    expect(res.status).toBe(409);
    expect(m.confirmDeal).not.toHaveBeenCalled();

    db.accountContact.findUnique.mockResolvedValue(lead({}, "rep-1"));
    m.confirmDeal.mockResolvedValue({ id: "d1", code: "D-2026-001" });
    const won = await svc.requestMarkWon({ ctx, input: { leadId: ID, value: 500000, note: "PO received" } });
    expect(won.body).toMatchObject({ deal: { id: "d1" } });
    expect(m.confirmDeal.mock.calls[0][0]).toMatchObject({ contactId: ID, value: 500000, note: "PO received", actorUserId: AI });
  });

  it("request_merge records intent only: it validates the leads and merges nothing", async () => {
    db.accountContact.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const res = await svc.requestMerge({ ctx, input: { primaryLeadId: "a", duplicateLeadIds: ["b"], reason: "same" } });
    expect(res.body).toEqual({ recorded: true });
    db.accountContact.findMany.mockResolvedValue([{ id: "a" }]);
    await expect(svc.requestMerge({ ctx, input: { primaryLeadId: "a", duplicateLeadIds: ["b"], reason: "same" } })).rejects.toMatchObject({ status: 404 });
  });

  it("update_lead_phone refuses a number another lead already has", async () => {
    db.accountContact.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === ID
        ? lead({ phone: "919000000001" })
        : { id: "other", name: "Other", phone: "919876543210", pipelineStage: null, leadStage: null, account: { name: "O", ownerUserId: null } },
    );
    m.findAccountContactDuplicate.mockResolvedValue({ id: "other", name: "Other", phone: "919876543210", accountId: "a2" });
    const res = await svc.updateLeadPhone({ ctx, input: { leadId: ID, phone: "98765 43210" } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: "phone_in_use" });
    expect(m.applyContactPatch).not.toHaveBeenCalled();
  });
});

describe("approval executors", () => {
  it("expose exactly the tools whose verdict is APPROVAL", async () => {
    const { TOOLS } = await import("../registry/leads");
    const approval = Object.entries(TOOLS).filter(([, d]) => d.default === "APPROVAL").map(([n]) => n).sort();
    expect(Object.keys(svc.LEAD_APPROVAL_EXECUTORS).sort()).toEqual(approval);
  });
});
