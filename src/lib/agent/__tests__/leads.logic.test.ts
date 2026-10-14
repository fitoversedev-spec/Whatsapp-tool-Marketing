import { describe, expect, it } from "vitest";
import {
  applyFieldPatch,
  canAgentCompleteTask,
  checkDueAt,
  decideDuplicate,
  escalationTaskText,
  findRecentSamePhone,
  isAssignableHuman,
  maskPhone,
  mergeCustomFields,
  parseEscalationTargets,
  pickLeadSourceId,
  requirementPatch,
  resolveEscalationOwner,
  summaryTitle,
  type DuplicateMatch,
} from "../leads/logic";

describe("mergeCustomFields (merged, never replaced)", () => {
  it("keeps keys the caller did not send and updates the ones it did", () => {
    const r = mergeCustomFields({ Source: "Instagram", Floor: "wood" }, { Floor: "acrylic", Roof: "yes" });
    expect(r).toEqual({ ok: true, fields: { Source: "Instagram", Floor: "acrylic", Roof: "yes" }, changedKeys: ["Floor", "Roof"] });
  });

  it("does not report a key whose value is unchanged", () => {
    const r = mergeCustomFields({ A: "1" }, { A: "1" });
    expect(r).toMatchObject({ ok: true, changedKeys: [] });
  });

  it("an empty value clears the value but keeps the key", () => {
    const r = mergeCustomFields({ A: "1" }, { A: "" });
    expect(r).toMatchObject({ ok: true, fields: { A: "" } });
  });

  it("refuses the reserved agent.* namespace in either case, and prototype-ish keys", () => {
    for (const key of ["agent.sport", "Agent.budgetInr", "__proto__"]) {
      expect(mergeCustomFields({}, { [key]: "x" }).ok).toBe(false);
    }
  });

  it("refuses to grow past the total cap", () => {
    const existing = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, "v"]));
    expect(mergeCustomFields(existing, { extra: "v" }).ok).toBe(false);
    expect(mergeCustomFields(existing, { k1: "changed" }).ok).toBe(true);
  });

  it("does not mutate its inputs", () => {
    const existing = { A: "1" };
    mergeCustomFields(existing, { B: "2" });
    expect(existing).toEqual({ A: "1" });
  });
});

describe("requirements stored under agent.*", () => {
  it("namespaces and stringifies only what was sent", () => {
    expect(
      requirementPatch({ sport: "Badminton", budgetInr: 500000, courtLengthFt: 44, civilWorkNeeded: true, surfacePreferences: ["PU", "acrylic"] }),
    ).toEqual({
      "agent.sport": "Badminton",
      "agent.budgetInr": "500000",
      "agent.courtLengthFt": "44",
      "agent.civilWorkNeeded": "yes",
      "agent.surfacePreferences": "PU, acrylic",
    });
    expect(requirementPatch({ civilWorkNeeded: false })).toEqual({ "agent.civilWorkNeeded": "no" });
    expect(requirementPatch({})).toEqual({});
  });

  it("null clears a key, and a merge leaves every other field alone", () => {
    const existing = { Source: "Instagram", "agent.sport": "Tennis", "agent.city": "Pune" };
    const r = applyFieldPatch(existing, requirementPatch({ sport: null, timeline: "2 months" }));
    expect(r.fields).toEqual({ Source: "Instagram", "agent.city": "Pune", "agent.timeline": "2 months" });
    expect(r.changedKeys.sort()).toEqual(["agent.sport", "agent.timeline"]);
  });

  it("clearing a key that was never set changes nothing", () => {
    expect(applyFieldPatch({}, requirementPatch({ sport: null })).changedKeys).toEqual([]);
  });
});

describe("checkDueAt", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  it("accepts a time in the future within 180 days", () => {
    expect(checkDueAt("2026-10-13T10:00:01Z", now)).toBeNull();
    expect(checkDueAt("2027-04-10T10:00:00Z", now)).toBeNull(); // 179 days
  });
  it("rejects the past, now, and anything beyond 180 days", () => {
    expect(checkDueAt("2026-10-13T09:59:59Z", now)).toMatch(/future/);
    expect(checkDueAt("2026-10-13T10:00:00Z", now)).toMatch(/future/);
    expect(checkDueAt("2027-04-12T10:00:00Z", now)).toMatch(/180 days/);
    expect(checkDueAt("not a date", now)).toMatch(/valid/);
  });
});

describe("duplicate decision", () => {
  const person: DuplicateMatch = {
    kind: "person",
    id: "c1",
    name: "Ravi",
    phoneMasked: "******3210",
    company: "Ravi",
    stage: null,
    isLead: true,
    ownerAssigned: false,
  };
  it("no matches: create", () => {
    expect(decideDuplicate([], {})).toEqual({ action: "create", confirmedDespite: null });
  });
  it("a match stops the create", () => {
    expect(decideDuplicate([person], {})).toEqual({ action: "conflict" });
  });
  it("needs BOTH the flag and a reason to go ahead", () => {
    expect(decideDuplicate([person], { confirmNotDuplicate: true })).toEqual({ action: "conflict" });
    expect(decideDuplicate([person], { confirmNotDuplicate: true, duplicateReason: "   " })).toEqual({ action: "conflict" });
    expect(decideDuplicate([person], { duplicateReason: "different person" })).toEqual({ action: "conflict" });
    expect(decideDuplicate([person], { confirmNotDuplicate: false, duplicateReason: "x" })).toEqual({ action: "conflict" });
    expect(decideDuplicate([person], { confirmNotDuplicate: true, duplicateReason: " Brother, other number " })).toEqual({
      action: "create",
      confirmedDespite: "Brother, other number",
    });
  });
});

describe("natural-key dedupe (same phone within 10 minutes)", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  const row = (phone: string | null, minutesAgo: number) => ({
    id: `${phone}-${minutesAgo}`,
    phone,
    createdAt: new Date(now.getTime() - minutesAgo * 60_000),
  });

  it("matches the same number however it was written", () => {
    const rows = [row("919876543210", 3)];
    expect(findRecentSamePhone(rows, "+91 98765 43210", now)).toBe(rows[0]);
    expect(findRecentSamePhone(rows, "9876543210", now)).toBe(rows[0]);
  });
  it("ignores other numbers, rows without a phone, and anything older than 10 minutes", () => {
    expect(findRecentSamePhone([row("919876543211", 1)], "9876543210", now)).toBeNull();
    expect(findRecentSamePhone([row(null, 1)], "9876543210", now)).toBeNull();
    expect(findRecentSamePhone([row("919876543210", 11)], "9876543210", now)).toBeNull();
    expect(findRecentSamePhone([row("919876543210", 10)], "9876543210", now)).not.toBeNull();
  });
  it("an unparseable phone matches nothing", () => {
    expect(findRecentSamePhone([row("919876543210", 1)], "abc", now)).toBeNull();
  });
});

describe("masking and lead source", () => {
  it("shows only the last four digits", () => {
    expect(maskPhone("919876543210")).toBe("********3210");
    expect(maskPhone("1234")).toBe("****");
    expect(maskPhone(null)).toBeNull();
  });
  it("prefers the AI's own source, then the closest existing one, then none", () => {
    const rows = [
      { id: "w", slug: "whatsapp_inbound" },
      { id: "ai", slug: "ai_sales_agent" },
    ];
    expect(pickLeadSourceId(rows)).toBe("ai");
    expect(pickLeadSourceId([rows[0]])).toBe("w");
    expect(pickLeadSourceId([{ id: "x", slug: "walk_in" }])).toBeNull();
  });
});

describe("who can take a lead", () => {
  const ok = { role: "sales", isActive: true, approvalStatus: "approved", deletedAt: null };
  it("only active, approved salespeople and managers", () => {
    expect(isAssignableHuman(ok)).toBe(true);
    expect(isAssignableHuman({ ...ok, role: "manager" })).toBe(true);
    expect(isAssignableHuman({ ...ok, role: "ai_agent" })).toBe(false);
    expect(isAssignableHuman({ ...ok, role: "admin" })).toBe(false);
    expect(isAssignableHuman({ ...ok, role: "management" })).toBe(false);
    expect(isAssignableHuman({ ...ok, isActive: false })).toBe(false);
    expect(isAssignableHuman({ ...ok, approvalStatus: "pending" })).toBe(false);
    expect(isAssignableHuman({ ...ok, deletedAt: new Date() })).toBe(false);
    expect(isAssignableHuman(null)).toBe(false);
  });
});

describe("escalation targets", () => {
  it("reads the Setting JSON and treats anything malformed as not configured", () => {
    expect(parseEscalationTargets('{"sales":["u1","u2"],"civil_engineer":["u3"],"manager":[]}')).toEqual({
      sales: ["u1", "u2"],
      civil_engineer: ["u3"],
      manager: [],
    });
    const empty = { sales: [], civil_engineer: [], manager: [] };
    expect(parseEscalationTargets(null)).toEqual(empty);
    expect(parseEscalationTargets("{not json")).toEqual(empty);
    expect(parseEscalationTargets("[1,2]")).toEqual(empty);
    expect(parseEscalationTargets('{"sales":"u1","manager":[1,null,"u9","u9"]}')).toEqual({
      sales: [],
      civil_engineer: [],
      manager: ["u9"],
    });
  });

  const eligible = (...ids: string[]) => new Set(ids);

  it("uses the first eligible configured person", () => {
    expect(
      resolveEscalationOwner({ configuredIds: ["gone", "u2", "u3"], repId: "rep", adminIds: ["adm"], eligible: eligible("u2", "u3", "rep", "adm") }),
    ).toEqual({ userId: "u2", source: "configured" });
  });
  it("falls back to the lead's rep when the target is not configured (or nobody configured is eligible)", () => {
    expect(resolveEscalationOwner({ configuredIds: [], repId: "rep", adminIds: ["adm"], eligible: eligible("rep", "adm") })).toEqual({
      userId: "rep",
      source: "rep",
    });
    expect(
      resolveEscalationOwner({ configuredIds: ["gone"], repId: "rep", adminIds: ["adm"], eligible: eligible("rep", "adm") })?.source,
    ).toBe("rep");
  });
  it("then to an active admin, skipping ineligible ones", () => {
    expect(resolveEscalationOwner({ configuredIds: [], repId: null, adminIds: ["a1", "a2"], eligible: eligible("a2") })).toEqual({
      userId: "a2",
      source: "admin",
    });
    expect(resolveEscalationOwner({ configuredIds: [], repId: "rep", adminIds: ["a1"], eligible: eligible("a1") })).toEqual({
      userId: "a1",
      source: "admin",
    });
  });
  it("nobody eligible: null", () => {
    expect(resolveEscalationOwner({ configuredIds: ["x"], repId: "rep", adminIds: ["a"], eligible: eligible() })).toBeNull();
  });
  it("task text names the target and stays within 500 characters", () => {
    expect(escalationTaskText("civil_engineer", "site visit")).toBe("Escalated to civil engineer: site visit");
    expect(escalationTaskText("sales", "x".repeat(900))).toHaveLength(500);
  });
});

describe("the AI completes only the tasks it created", () => {
  it("compares the task's creator with the AI's user", () => {
    expect(canAgentCompleteTask({ createdByUserId: "ai-user" }, "ai-user")).toBe(true);
    expect(canAgentCompleteTask({ createdByUserId: "rep-1" }, "ai-user")).toBe(false);
  });
});

describe("summaryTitle", () => {
  it("uses the IST date", () => {
    expect(summaryTitle(new Date("2026-10-13T10:00:00Z"))).toBe("AI conversation summary — 13 Oct 2026");
    // 19:00 UTC is already the next day in India.
    expect(summaryTitle(new Date("2026-10-13T19:00:00Z"))).toBe("AI conversation summary — 14 Oct 2026");
  });
});
