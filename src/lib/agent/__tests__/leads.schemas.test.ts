import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { AGENT_ROUTES, buildOpenApi } from "../openapi";
import { TOOL_REGISTRY } from "../permissions";
import { ROUTES, TOOLS } from "../registry/leads";
import * as S from "../schemas/leads";

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const ID2 = "4f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e50";
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

type Parser = { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } };
const ok = (schema: Parser, v: unknown) => schema.safeParse(v).success;
const message = (schema: Parser, v: unknown) => {
  const r = schema.safeParse(v);
  return r.success ? "" : r.error!.issues.map((i) => i.message).join("; ");
};

describe("create_lead", () => {
  const base = { name: "Ravi Kumar", phone: "+91 98765 43210" };
  it("needs a name and a valid phone", () => {
    expect(ok(S.createLeadInputSchema, base)).toBe(true);
    expect(ok(S.createLeadInputSchema, { phone: base.phone })).toBe(false);
    expect(ok(S.createLeadInputSchema, { name: "R" })).toBe(false);
    expect(ok(S.createLeadInputSchema, { ...base, phone: "12" })).toBe(false);
    expect(ok(S.createLeadInputSchema, { ...base, phone: "abcdefghij" })).toBe(false);
  });
  it("confirmNotDuplicate requires a duplicateReason", () => {
    expect(ok(S.createLeadInputSchema, { ...base, confirmNotDuplicate: true })).toBe(false);
    expect(message(S.createLeadInputSchema, { ...base, confirmNotDuplicate: true })).toMatch(/duplicateReason/);
    expect(ok(S.createLeadInputSchema, { ...base, confirmNotDuplicate: true, duplicateReason: "Different person, same shop" })).toBe(true);
  });
  it("cannot set an owner, a source or a stage", () => {
    for (const extra of [{ ownerUserId: ID }, { leadSourceId: ID }, { leadStageId: ID }, { accountId: ID }]) {
      expect(ok(S.createLeadInputSchema, { ...base, ...extra })).toBe(false);
    }
  });
  it("rejects bad email and oversize text", () => {
    expect(ok(S.createLeadInputSchema, { ...base, email: "nope" })).toBe(false);
    expect(ok(S.createLeadInputSchema, { ...base, notes: "x".repeat(2001) })).toBe(false);
  });
});

describe("update_lead_details", () => {
  it("rejects a phone change (that is update_lead_phone)", () => {
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID, phone: "9876543210" })).toBe(false);
    expect(message(S.updateLeadDetailsInputSchema, { leadId: ID, phone: "9876543210" })).toMatch(/Unrecognized/i);
  });
  it("needs at least one field, and the lead id", () => {
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID })).toBe(false);
    expect(ok(S.updateLeadDetailsInputSchema, { name: "A" })).toBe(false);
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID, name: "A" })).toBe(true);
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID, designation: null })).toBe(true);
    expect(ok(S.updateLeadDetailsBodySchema, {})).toBe(false);
  });
  it("custom fields: no agent.* keys, no odd keys, bounded", () => {
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID, customFields: { Floor: "wood" } })).toBe(true);
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID, customFields: { "agent.sport": "x" } })).toBe(false);
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID, customFields: { "<script>": "x" } })).toBe(false);
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID, customFields: { A: "x".repeat(501) } })).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, "v"]));
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID, customFields: many })).toBe(false);
  });
  it("only known business types", () => {
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID, businessType: "B2G" })).toBe(true);
    expect(ok(S.updateLeadDetailsInputSchema, { leadId: ID, businessType: "retail" })).toBe(false);
  });
});

describe("set_requirements", () => {
  const valid = { leadId: ID, sport: "Badminton", budgetInr: 450000, courtLengthFt: 44, courtWidthFt: 20 };
  it("accepts sensible values", () => {
    expect(ok(S.setRequirementsInputSchema, valid)).toBe(true);
    expect(
      ok(S.setRequirementsInputSchema, { leadId: ID, civilWorkNeeded: false, b2bOrB2c: "B2B", surfacePreferences: ["PU"], sport: null }),
    ).toBe(true);
  });
  it("rejects negative, zero, fractional-rupee and absurd values", () => {
    for (const bad of [
      { budgetInr: -1 },
      { budgetInr: 0 },
      { budgetInr: 50 },
      { budgetInr: 1.5 },
      { budgetInr: 2_000_000_000 },
      { budgetInr: Number.NaN },
      { courtLengthFt: 0 },
      { courtLengthFt: -44 },
      { courtLengthFt: 5000 },
      { courtWidthFt: 1001 },
    ]) {
      expect(ok(S.setRequirementsInputSchema, { leadId: ID, ...bad }), JSON.stringify(bad)).toBe(false);
    }
  });
  it("rejects unknown keys, wrong enums, too many surfaces and an empty request", () => {
    expect(ok(S.setRequirementsInputSchema, { leadId: ID, colour: "red" })).toBe(false);
    expect(ok(S.setRequirementsInputSchema, { leadId: ID, b2bOrB2c: "both" })).toBe(false);
    expect(ok(S.setRequirementsInputSchema, { leadId: ID, surfacePreferences: Array(11).fill("PU") })).toBe(false);
    expect(ok(S.setRequirementsInputSchema, { leadId: ID })).toBe(false);
  });
});

describe("stage, notes, summaries, products", () => {
  it("set_lead_stage needs a stage id", () => {
    expect(ok(S.setLeadStageInputSchema, { leadId: ID, stageId: ID2 })).toBe(true);
    expect(ok(S.setLeadStageInputSchema, { leadId: ID, stageId: "Qualified" })).toBe(false);
  });
  it("notes are capped at 5000 characters and cannot be blank", () => {
    expect(ok(S.addNoteInputSchema, { leadId: ID, body: "x".repeat(5000) })).toBe(true);
    expect(ok(S.addNoteInputSchema, { leadId: ID, body: "x".repeat(5001) })).toBe(false);
    expect(ok(S.addNoteInputSchema, { leadId: ID, body: "   " })).toBe(false);
  });
  it("product interest needs an id or a label, and ids must be uuids", () => {
    expect(ok(S.addProductInterestInputSchema, { leadId: ID, productIds: [ID2] })).toBe(true);
    expect(ok(S.addProductInterestInputSchema, { leadId: ID, otherLabel: "Padel glass" })).toBe(true);
    expect(ok(S.addProductInterestInputSchema, { leadId: ID })).toBe(false);
    expect(ok(S.addProductInterestInputSchema, { leadId: ID, productIds: ["turf"] })).toBe(false);
    expect(ok(S.addProductInterestInputSchema, { leadId: ID, productIds: Array(31).fill(ID2) })).toBe(false);
  });
});

describe("follow-ups and activities", () => {
  it("a task is due in the future, within 180 days", () => {
    expect(ok(S.createFollowupInputSchema, { leadId: ID, text: "Call back", dueAt: future(2) })).toBe(true);
    expect(ok(S.createFollowupInputSchema, { leadId: ID, text: "Call back", dueAt: future(-1) })).toBe(false);
    expect(ok(S.createFollowupInputSchema, { leadId: ID, text: "Call back", dueAt: future(181) })).toBe(false);
    expect(ok(S.createFollowupInputSchema, { leadId: ID, text: "Call back", dueAt: "tomorrow" })).toBe(false);
    expect(ok(S.createFollowupInputSchema, { leadId: ID, text: "", dueAt: future(2) })).toBe(false);
  });
  it("accepts a +05:30 offset", () => {
    const iso = new Date(Date.now() + 2 * 86_400_000 + 19_800_000).toISOString().replace("Z", "+05:30");
    expect(ok(S.createFollowupInputSchema, { leadId: ID, text: "x", dueAt: iso })).toBe(true);
  });
  it("complete_task defaults done to true", () => {
    const r = S.completeTaskInputSchema.parse({ taskId: ID });
    expect(r.done).toBe(true);
    expect(ok(S.completeTaskInputSchema, { taskId: ID, done: "yes" })).toBe(false);
  });
  it("log_activity bounds the duration", () => {
    const base = { leadId: ID, activityTypeId: ID2, subject: "Call" };
    expect(ok(S.logActivityInputSchema, { ...base, durationMins: 15 })).toBe(true);
    expect(ok(S.logActivityInputSchema, { ...base, durationMins: -1 })).toBe(false);
    expect(ok(S.logActivityInputSchema, { ...base, durationMins: 1441 })).toBe(false);
    expect(ok(S.logActivityInputSchema, { ...base, durationMins: 1.5 })).toBe(false);
  });
});

describe("escalate_lead", () => {
  it("only sales, civil_engineer or manager, with a reason and a summary", () => {
    const base = { leadId: ID, reason: "Wants a site visit", summary: "Needs a civil survey for a 44x20 court." };
    for (const target of ["sales", "civil_engineer", "manager"]) expect(ok(S.escalateLeadInputSchema, { ...base, target })).toBe(true);
    expect(ok(S.escalateLeadInputSchema, { ...base, target: "admin" })).toBe(false);
    expect(ok(S.escalateLeadInputSchema, { ...base, target: "sales", reason: "" })).toBe(false);
    expect(ok(S.escalateLeadInputSchema, { leadId: ID, target: "sales", reason: "x" })).toBe(false);
  });
});

describe("requests that wait for a human", () => {
  it("merge: distinct leads, 1-5 duplicates", () => {
    expect(ok(S.requestMergeInputSchema, { primaryLeadId: ID, duplicateLeadIds: [ID2], reason: "Same person" })).toBe(true);
    expect(ok(S.requestMergeInputSchema, { primaryLeadId: ID, duplicateLeadIds: [ID], reason: "Same" })).toBe(false);
    expect(ok(S.requestMergeInputSchema, { primaryLeadId: ID, duplicateLeadIds: [], reason: "Same" })).toBe(false);
    expect(ok(S.requestMergeInputSchema, { primaryLeadId: ID, duplicateLeadIds: [ID2, ID2], reason: "Same" })).toBe(false);
  });
  it("mark won: a positive, bounded value", () => {
    expect(ok(S.requestMarkWonInputSchema, { leadId: ID, value: 850000 })).toBe(true);
    for (const value of [0, -5, 1_000_000_000]) expect(ok(S.requestMarkWonInputSchema, { leadId: ID, value })).toBe(false);
    expect(ok(S.requestMarkWonInputSchema, { leadId: ID, value: 1, expectedStartAt: "soon" })).toBe(false);
  });
  it("phone change: a valid number", () => {
    expect(ok(S.updateLeadPhoneInputSchema, { leadId: ID, phone: "9876543210" })).toBe(true);
    expect(ok(S.updateLeadPhoneInputSchema, { leadId: ID, phone: "98" })).toBe(false);
  });
});

describe("ad leads", () => {
  it("stage, note and move-to-crm take only the ad lead id and their own fields", () => {
    expect(ok(S.setAdLeadStageInputSchema, { adLeadId: ID, stage: "QUALIFIED" })).toBe(true);
    expect(ok(S.addAdLeadNoteInputSchema, { adLeadId: ID, body: "x".repeat(4001) })).toBe(false);
    expect(ok(S.moveAdLeadInputSchema, { adLeadId: ID })).toBe(true);
    // No way to pick an owner when moving to the CRM.
    expect(ok(S.moveAdLeadInputSchema, { adLeadId: ID, ownerUserId: ID2 })).toBe(false);
  });
});

describe("every path id travels in the input (so an approval keeps it)", () => {
  it("input schemas require the id, body schemas do not", () => {
    expect(ok(S.addNoteInputSchema, { body: "hi" })).toBe(false);
    expect(ok(S.addNoteBodySchema, { body: "hi" })).toBe(true);
    expect(ok(S.completeTaskInputSchema, { done: true })).toBe(false);
    expect(ok(S.addAdLeadNoteInputSchema, { body: "hi" })).toBe(false);
  });
});

describe("registry", () => {
  const approval = ["update_lead_phone", "remove_from_leads", "reassign_lead", "request_merge", "request_mark_won"];

  it("registers the twenty lead tools, each with exactly one route", () => {
    expect(Object.keys(TOOLS)).toHaveLength(20);
    expect(ROUTES.map((r) => r.tool).sort()).toEqual(Object.keys(TOOLS).sort());
    for (const r of ROUTES) {
      expect(r.requestSchema, r.tool!).toBeDefined();
      expect(TOOL_REGISTRY[r.tool!], r.tool!).toBeDefined();
    }
  });

  it("only the five approval-gated tools wait for a human, and they cannot be loosened", () => {
    for (const [name, def] of Object.entries(TOOLS)) {
      expect(def.default, name).toBe(approval.includes(name) ? "APPROVAL" : "ALLOWED");
      expect(def.action, name).not.toBe("read");
      expect(!!def.neverLoosen, name).toBe(approval.includes(name));
    }
  });

  it("nothing in this area can delete, bulk-update or touch users and settings", () => {
    for (const r of ROUTES) {
      expect(r.method, r.path).not.toBe("delete");
      expect(r.path, r.path).not.toMatch(/bulk|users|settings/);
    }
    expect(Object.values(TOOLS).some((t) => t.action === "delete")).toBe(false);
  });

  it("the OpenAPI document includes every lead route with a request body", () => {
    const doc = buildOpenApi() as unknown as {
      paths: Record<string, Record<string, { requestBody?: unknown; "x-tool"?: string }>>;
    };
    for (const r of ROUTES) {
      const op = doc.paths[r.path]?.[r.method];
      expect(op, `${r.method} ${r.path}`).toBeDefined();
      expect(op["x-tool"]).toBe(r.tool);
      expect(op.requestBody).toBeDefined();
    }
    expect(AGENT_ROUTES.length).toBeGreaterThan(ROUTES.length);
  });
});
