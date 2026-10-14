import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  template: { findUnique: vi.fn() },
  broadcastGroup: { findUnique: vi.fn() },
  contact: { findMany: vi.fn() },
  optOut: { findMany: vi.fn() },
  broadcast: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  setting: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));
const control = vi.hoisted(() => ({ startBroadcast: vi.fn(), requestBroadcastPause: vi.fn() }));
vi.mock("@/lib/broadcasts/control", () => control);

import { effectiveVerdict } from "../permissions";
import { EXECUTORS, ROUTES, TOOLS } from "../registry/deals";
import { draftBroadcast, getBroadcastStatus, pauseBroadcast } from "../deals/broadcasts";
import {
  checkCaps,
  getCampaignLimits,
  istDayRange,
  loadDailyUsage,
  resetCampaignLimitsCache,
  resolveCampaignLimits,
} from "../deals/campaignLimits";
import { launchBroadcastExecutor, scheduleBroadcastExecutor } from "../deals/executors";
import { checkBroadcastTemplate, classifyRecipients, validateVariableMapping } from "../deals/recipients";
import { draftBroadcastBodySchema, launchBroadcastBodySchema, scheduleBroadcastBodySchema } from "../schemas/deals";
import type { AgentHandlerArgs } from "../withAgent";

const ROOT = path.resolve(__dirname, "../../../..");
const CTX = {
  identityId: "idn-1",
  userId: "agent-user",
  credentialId: "cred-1",
  environment: "staging" as const,
  correlationId: "corr-12345678",
  ip: null,
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TEMPLATE = uuid(900);
const BC = uuid(800);
const GROUP = uuid(700);

function args<I>(input: I, params: Record<string, string> = {}): AgentHandlerArgs<I> {
  return {
    ctx: CTX,
    meta: { identityName: "a", credentialLabel: "l", keyPrefix: "fvai_stg_x", expiresAt: null },
    input,
    req: new Request("https://app.test/x"),
    params,
    idempotencyKey: "idem-key-0001",
  };
}
const code = (r: { body: unknown }) => (r.body as { error: { code: string } }).error.code;
const contact = (n: number, over: Record<string, unknown> = {}) => ({
  id: uuid(n),
  phone: `91987650${String(n).padStart(4, "0")}`,
  allowCampaign: true,
  ...over,
});
const contacts = (count: number, from = 1) => Array.from({ length: count }, (_, i) => contact(from + i));
const template = (over: Record<string, unknown> = {}) => ({
  id: TEMPLATE,
  name: "diwali_offer",
  category: "MARKETING",
  body: "Hi {{1}}, our turf offer is on",
  status: "approved",
  deletedAt: null,
  ...over,
});
const draftInput = (over: Record<string, unknown> = {}) =>
  draftBroadcastBodySchema.parse({
    name: "Diwali turf",
    templateId: TEMPLATE,
    contactIds: [uuid(1), uuid(2), uuid(3)],
    variableMapping: { "1": "name" },
    ...over,
  });
const storedMapping = (call = 0) => JSON.parse(db.broadcast.create.mock.calls[call][0].data.variableMapping);

/** A broadcast row as launch/schedule read it. */
const ownBroadcast = (over: Record<string, unknown> = {}, mapping: Record<string, unknown> = {}) => ({
  id: BC,
  status: "draft",
  sourceType: "contacts",
  variableMapping: JSON.stringify({
    variables: { "1": "name" },
    filterRules: [],
    selectedContactIds: [uuid(1), uuid(2), uuid(3)],
    groupId: null,
    agent: { recipientCount: 3 },
    ...mapping,
  }),
  template: { id: TEMPLATE, category: "MARKETING", status: "approved", deletedAt: null },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetCampaignLimitsCache();
  db.setting.findUnique.mockResolvedValue(null);
  db.template.findUnique.mockResolvedValue(template());
  db.broadcastGroup.findUnique.mockResolvedValue({ id: GROUP, name: "Goa leads" });
  db.contact.findMany.mockResolvedValue(contacts(3));
  db.optOut.findMany.mockResolvedValue([]);
  db.broadcast.findMany.mockResolvedValue([]);
  db.broadcast.findFirst.mockResolvedValue(ownBroadcast());
  db.broadcast.updateMany.mockResolvedValue({ count: 1 });
  db.broadcast.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: BC,
    ...data,
    scheduledAt: (data.scheduledAt as Date | null) ?? null,
  }));
  control.startBroadcast.mockResolvedValue({ kind: "started", total: 3 });
  control.requestBroadcastPause.mockResolvedValue({ ok: true, pauseRequestedAt: "2026-10-13T10:00:00.000Z" });
});

// ---------------------------------------------------------------------------

describe("campaign registry", () => {
  it("registers the agreed verdicts", () => {
    const want: Record<string, string> = {
      draft_broadcast: "ALLOWED",
      get_broadcast_status: "ALLOWED",
      pause_broadcast: "ALLOWED",
      launch_broadcast: "APPROVAL",
      schedule_broadcast: "APPROVAL",
    };
    for (const [tool, verdict] of Object.entries(want)) expect(TOOLS[tool].default, tool).toBe(verdict);
  });

  it("launch and schedule cannot be loosened, only tightened", () => {
    for (const t of ["launch_broadcast", "schedule_broadcast"]) {
      expect(TOOLS[t].neverLoosen).toBe(true);
      expect(effectiveVerdict(t, { [t]: "ALLOWED" })).toBe("APPROVAL");
      expect(effectiveVerdict(t, { [t]: "NEVER" })).toBe("NEVER");
    }
  });

  it("there is no tool to list templates here (stage 3 owns list_templates) and no bulk/file/sheet entry point", () => {
    expect(TOOLS.list_broadcast_templates).toBeUndefined();
    expect(Object.keys(TOOLS).filter((t) => /file|sheet|upload|import/.test(t))).toEqual([]);
  });

  it("every campaign route has a route.ts wrapping its tool in withAgent; approval routes carry the id", () => {
    const routes = ROUTES.filter((r) => r.path.startsWith("/broadcasts"));
    expect(routes.map((r) => r.tool).sort()).toEqual(
      ["draft_broadcast", "get_broadcast_status", "launch_broadcast", "pause_broadcast", "schedule_broadcast"].sort(),
    );
    for (const r of routes) {
      const file = path.join(ROOT, "src/app/api/agent/v1", r.path.replace(/\{id\}/g, "[id]"), "route.ts");
      expect(existsSync(file), file).toBe(true);
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain(`withAgent("${r.tool}"`);
      if (TOOLS[r.tool!].default === "APPROVAL") expect(text, file).toContain('id: "broadcastId"');
    }
  });
});

// ---------------------------------------------------------------------------

describe("draft_broadcast: the input contract", () => {
  const ok = { name: "n", templateId: TEMPLATE, contactIds: [uuid(1)], variableMapping: { "1": "name" } };
  it("accepts contacts or a group", () => {
    expect(draftBroadcastBodySchema.safeParse(ok).success).toBe(true);
    const { contactIds: _c, ...rest } = ok;
    expect(draftBroadcastBodySchema.safeParse({ ...rest, groupId: GROUP }).success).toBe(true);
  });

  it("takes exactly one of contactIds or groupId", () => {
    const { contactIds: _c, ...rest } = ok;
    expect(draftBroadcastBodySchema.safeParse(rest).success).toBe(false);
    expect(draftBroadcastBodySchema.safeParse({ ...ok, groupId: GROUP }).success).toBe(false);
  });

  it("caps contactIds at 200 and needs at least one", () => {
    expect(draftBroadcastBodySchema.safeParse({ ...ok, contactIds: Array.from({ length: 200 }, (_, i) => uuid(i + 1)) }).success).toBe(true);
    expect(draftBroadcastBodySchema.safeParse({ ...ok, contactIds: Array.from({ length: 201 }, (_, i) => uuid(i + 1)) }).success).toBe(false);
    expect(draftBroadcastBodySchema.safeParse({ ...ok, contactIds: [] }).success).toBe(false);
  });

  it("is CONTACTS only: a file, a sheet, a source type, filters or scheduling are rejected", () => {
    for (const extra of [
      { sourceType: "file" },
      { sourceType: "contacts" },
      { fileData: "a,b\n1,2" },
      { sheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit" },
      { sheetRange: "A1:B2" },
      { filterRules: [] },
      { phoneColumn: "phone" },
      { scheduledAt: "2026-12-01T10:00:00Z" },
      { createdByUserId: "someone" },
    ]) {
      expect(draftBroadcastBodySchema.safeParse({ ...ok, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("validates ids, names and the placeholder mapping", () => {
    for (const bad of [
      { templateId: "not-a-uuid" },
      { contactIds: ["x"] },
      { name: "" },
      { name: "x".repeat(121) },
      { variableMapping: { one: "name" } },
      { variableMapping: { "0": "name" } },
      { variableMapping: { "1": "" } },
    ]) {
      expect(draftBroadcastBodySchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("launch and schedule bodies are strict (the id comes from the URL)", () => {
    expect(launchBroadcastBodySchema.safeParse({}).success).toBe(true);
    expect(launchBroadcastBodySchema.safeParse({ note: "Festival offer" }).success).toBe(true);
    expect(launchBroadcastBodySchema.safeParse({ contactIds: [uuid(1)] }).success).toBe(false);
    expect(scheduleBroadcastBodySchema.safeParse({ scheduledAt: "2026-12-01T10:00:00Z" }).success).toBe(true);
    expect(scheduleBroadcastBodySchema.safeParse({ scheduledAt: "tomorrow" }).success).toBe(false);
    expect(scheduleBroadcastBodySchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("draft_broadcast", () => {
  it("creates a DRAFT for the agent from saved contacts and reports the eligible count", async () => {
    const r = await draftBroadcast(args(draftInput()));
    expect(r.status ?? 200).toBe(200);
    expect(r.body).toMatchObject({
      broadcast: { id: BC, status: "draft" },
      eligibleRecipients: 3,
      excluded: { optedOut: 0, noCampaignConsent: 0, notFound: 0 },
      limits: { maxRecipients: 200, maxPerDay: 500, usedToday: 0 },
    });
    const data = db.broadcast.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ sourceType: "contacts", status: "draft", createdByUserId: "agent-user", templateId: TEMPLATE });
    expect(data.scheduledAt).toBeNull();
    expect(data.fileData).toBeNull();
    expect(data.sheetId).toBeNull();
    expect(control.startBroadcast).not.toHaveBeenCalled();
  });

  it("freezes only the eligible people into the draft (never an empty list, never a group)", async () => {
    await draftBroadcast(args(draftInput()));
    const m = storedMapping();
    expect(m.selectedContactIds).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(m.groupId).toBeNull();
    expect(m.variables).toEqual({ "1": "name" });
    expect(m.agent.recipientCount).toBe(3);
  });

  it("leaves out opted-out contacts and contacts with allowCampaign=false, and counts them", async () => {
    db.contact.findMany.mockResolvedValue([contact(1), contact(2, { allowCampaign: false }), contact(3), contact(4)]);
    db.optOut.findMany.mockResolvedValue([{ phoneE164: contact(3).phone }]);
    const r = await draftBroadcast(args(draftInput({ contactIds: [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)] })));
    expect(r.body).toMatchObject({
      eligibleRecipients: 2,
      excluded: { optedOut: 1, noCampaignConsent: 1, notFound: 1 },
    });
    expect(storedMapping().selectedContactIds).toEqual([uuid(1), uuid(4)]);
  });

  it("matches an opt-out recorded under another spelling of the number", async () => {
    // a 10-digit local number; the opt-out is stored as 91 + number
    db.contact.findMany.mockResolvedValue([contact(1, { phone: "9876500001" }), contact(2)]);
    db.optOut.findMany.mockResolvedValue([{ phoneE164: "919876500001" }]);
    const r = await draftBroadcast(args(draftInput({ contactIds: [uuid(1), uuid(2)] })));
    expect(r.body).toMatchObject({ eligibleRecipients: 1, excluded: { optedOut: 1 } });
    const asked = db.optOut.findMany.mock.calls[0][0].where.phoneE164.in as string[];
    expect(asked).toEqual(expect.arrayContaining(["9876500001", "919876500001"]));
  });

  it("an opted-out contact who also lacks consent counts once, as opted out", () => {
    const r = classifyRecipients([contact(1, { allowCampaign: false })], new Set([contact(1).phone]));
    expect(r.excluded).toEqual({ optedOut: 1, noCampaignConsent: 0, notFound: 0 });
  });

  it("refuses to create anything when nobody is eligible (an empty list would mean 'all contacts')", async () => {
    db.contact.findMany.mockResolvedValue([contact(1, { allowCampaign: false }), contact(2)]);
    db.optOut.findMany.mockResolvedValue([{ phoneE164: contact(2).phone }]);
    const r = await draftBroadcast(args(draftInput({ contactIds: [uuid(1), uuid(2)] })));
    expect(r.status).toBe(422);
    expect(code(r)).toBe("no_eligible_recipients");
    expect(db.broadcast.create).not.toHaveBeenCalled();
  });

  it("a group is read now and frozen: members become selectedContactIds, groupId is not stored", async () => {
    db.contact.findMany.mockResolvedValue(contacts(4));
    const r = await draftBroadcast(args(draftBroadcastBodySchema.parse({ name: "G", templateId: TEMPLATE, groupId: GROUP, variableMapping: { "1": "name" } })));
    expect(db.contact.findMany.mock.calls[0][0].where).toEqual({ groups: { some: { groupId: GROUP } } });
    expect(r.body).toMatchObject({ eligibleRecipients: 4 });
    const m = storedMapping();
    expect(m.groupId).toBeNull();
    expect(m.selectedContactIds).toHaveLength(4);
    expect(m.agent.source).toEqual({ type: "group", id: GROUP, name: "Goa leads" });
  });

  it("404s on a group that does not exist, and refuses a group too large to look at", async () => {
    db.broadcastGroup.findUnique.mockResolvedValue(null);
    await expect(
      draftBroadcast(args(draftBroadcastBodySchema.parse({ name: "G", templateId: TEMPLATE, groupId: GROUP, variableMapping: { "1": "name" } }))),
    ).rejects.toMatchObject({ code: "not_found" });
    db.broadcastGroup.findUnique.mockResolvedValue({ id: GROUP, name: "Big" });
    db.contact.findMany.mockResolvedValue(contacts(5001));
    const r = await draftBroadcast(args(draftBroadcastBodySchema.parse({ name: "G", templateId: TEMPLATE, groupId: GROUP, variableMapping: { "1": "name" } })));
    expect(code(r)).toBe("group_too_large");
    expect(db.broadcast.create).not.toHaveBeenCalled();
  });

  describe("recipient cap (default 200 per campaign)", () => {
    const group = () => draftBroadcastBodySchema.parse({ name: "G", templateId: TEMPLATE, groupId: GROUP, variableMapping: { "1": "name" } });

    it("allows exactly 200 and refuses 201", async () => {
      db.contact.findMany.mockResolvedValue(contacts(200));
      expect((await draftBroadcast(args(group()))).status ?? 200).toBe(200);
      db.broadcast.create.mockClear();
      db.contact.findMany.mockResolvedValue(contacts(201));
      const r = await draftBroadcast(args(group()));
      expect(r.status).toBe(422);
      expect(code(r)).toBe("over_recipient_cap");
      expect(db.broadcast.create).not.toHaveBeenCalled();
    });

    it("counts eligible people, not members: 210 members of whom 20 are opted out is 190", async () => {
      db.contact.findMany.mockResolvedValue(contacts(210));
      db.optOut.findMany.mockResolvedValue(contacts(20).map((c) => ({ phoneE164: c.phone })));
      const r = await draftBroadcast(args(group()));
      expect(r.body).toMatchObject({ eligibleRecipients: 190 });
    });

    it("takes the limit from Setting agent_campaign_limits", async () => {
      db.setting.findUnique.mockResolvedValue({ value: JSON.stringify({ maxRecipients: 2, maxPerDay: 10 }) });
      const r = await draftBroadcast(args(draftInput()));
      expect(code(r)).toBe("over_recipient_cap");
      expect((r.body as { error: { message: string } }).error.message).toContain("at most 2");
      expect(db.setting.findUnique.mock.calls[0][0]).toEqual({ where: { key: "agent_campaign_limits" } });
    });
  });

  describe("daily cap (default 500 across the agent)", () => {
    const used = (n: number) => db.broadcast.findMany.mockResolvedValue([{ status: "completed", total: n, variableMapping: "{}" }]);

    it("refuses a draft that would take the day past 500", async () => {
      used(498);
      const r = await draftBroadcast(args(draftInput()));
      expect(r.status).toBe(429);
      expect(code(r)).toBe("over_daily_cap");
      expect(db.broadcast.create).not.toHaveBeenCalled();
    });

    it("allows reaching exactly 500", async () => {
      used(497);
      const r = await draftBroadcast(args(draftInput()));
      expect(r.body).toMatchObject({ limits: { usedToday: 497 } });
      expect(db.broadcast.create).toHaveBeenCalled();
    });

    it("adds up the AI's own campaigns for the IST day: launched ones, and scheduled ones by their recorded count", async () => {
      db.broadcast.findMany.mockResolvedValue([
        { status: "completed", total: 100, variableMapping: "{}" },
        { status: "scheduled", total: 0, variableMapping: JSON.stringify({ agent: { recipientCount: 150 } }) },
        { status: "failed", total: 0, variableMapping: JSON.stringify({ agent: { recipientCount: 80 } }) },
      ]);
      await expect(loadDailyUsage("agent-user", new Date("2026-10-13T06:00:00Z"))).resolves.toBe(250);
      const where = db.broadcast.findMany.mock.calls[0][0].where;
      expect(where.createdByUserId).toBe("agent-user");
      expect(where.status.in).not.toContain("draft");
      expect(where.OR[0].launchedAt.gte).toEqual(new Date("2026-10-12T18:30:00.000Z"));
      expect(where.OR[0].launchedAt.lte).toEqual(new Date("2026-10-13T18:29:59.999Z"));
    });

    it("a day with too many campaigns to add up counts as full", async () => {
      db.broadcast.findMany.mockResolvedValue(Array.from({ length: 500 }, () => ({ status: "completed", total: 1, variableMapping: "{}" })));
      const r = await draftBroadcast(args(draftInput()));
      expect(code(r)).toBe("over_daily_cap");
    });
  });

  describe("the template", () => {
    it("must exist, be approved and not deleted", async () => {
      db.template.findUnique.mockResolvedValue(null);
      await expect(draftBroadcast(args(draftInput()))).rejects.toMatchObject({ code: "not_found" });
      db.template.findUnique.mockResolvedValue(template({ deletedAt: new Date() }));
      await expect(draftBroadcast(args(draftInput()))).rejects.toMatchObject({ code: "not_found" });
      db.template.findUnique.mockResolvedValue(template({ status: "pending" }));
      expect(code(await draftBroadcast(args(draftInput())))).toBe("template_not_approved");
      expect(db.broadcast.create).not.toHaveBeenCalled();
    });

    it("allows UTILITY and MARKETING (launch is always held for a person) but nothing else", async () => {
      db.template.findUnique.mockResolvedValue(template({ category: "UTILITY" }));
      expect((await draftBroadcast(args(draftInput()))).body).toMatchObject({ template: { category: "UTILITY" } });
      db.template.findUnique.mockResolvedValue(template({ category: "MARKETING" }));
      expect((await draftBroadcast(args(draftInput()))).body).toMatchObject({ template: { category: "MARKETING" } });
      db.template.findUnique.mockResolvedValue(template({ category: "AUTHENTICATION" }));
      expect(code(await draftBroadcast(args(draftInput())))).toBe("template_category_not_allowed");
    });

    it("would refuse MARKETING if launching ever stopped needing approval", () => {
      const t = { status: "approved", deletedAt: null, category: "marketing" };
      expect(checkBroadcastTemplate(t, "APPROVAL").ok).toBe(true);
      expect(checkBroadcastTemplate(t, "ALLOWED")).toMatchObject({ ok: false, code: "marketing_requires_approved_launch" });
      expect(checkBroadcastTemplate({ ...t, category: "UTILITY" }, "ALLOWED").ok).toBe(true);
    });

    it("needs a contact field for every placeholder and nothing more", async () => {
      db.template.findUnique.mockResolvedValue(template({ body: "Hi {{1}}, {{2}} awaits" }));
      await expect(draftBroadcast(args(draftInput({ variableMapping: { "1": "name" } })))).rejects.toMatchObject({ code: "invalid_input" });
      db.template.findUnique.mockResolvedValue(template({ body: "No placeholders here" }));
      await expect(draftBroadcast(args(draftInput({ variableMapping: { "1": "name" } })))).rejects.toMatchObject({ code: "invalid_input" });
      expect((await draftBroadcast(args(draftInput({ variableMapping: {} })))).status ?? 200).toBe(200);
      expect(validateVariableMapping("Hi {{1}} {{2}}", { "1": "name", "2": "city" })).toBeNull();
      expect(validateVariableMapping("Hi {{1}} {{3}}", { "1": "a", "2": "b" })).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------

describe("get_broadcast_status", () => {
  const row = {
    id: BC,
    name: "Diwali turf",
    status: "running",
    total: 40,
    sent: 30,
    delivered: 20,
    read: 5,
    failed: 1,
    scheduledAt: null,
    launchedAt: new Date("2026-10-13T05:00:00Z"),
    completedAt: null,
    createdAt: new Date("2026-10-13T04:00:00Z"),
    pauseRequestedAt: null,
    variableMapping: "{}",
  };

  it("reads only the agent's own broadcast and returns counters, not recipients or the sheet", async () => {
    db.broadcast.findFirst.mockResolvedValue(row);
    const r = await getBroadcastStatus(args(undefined, { id: BC }));
    expect(db.broadcast.findFirst.mock.calls[0][0].where).toEqual({ id: BC, createdByUserId: "agent-user" });
    expect(r.body).toMatchObject({ id: BC, status: "running", recipients: 40, sent: 30, delivered: 20, read: 5, failed: 1, pauseRequested: false });
    const keys = Object.keys(r.body as object);
    for (const leaked of ["fileData", "variableMapping", "recipientsList", "template", "createdByUserId"]) expect(keys).not.toContain(leaked);
  });

  it("someone else's broadcast, a missing one and a malformed id are all 404", async () => {
    db.broadcast.findFirst.mockResolvedValue(null);
    await expect(getBroadcastStatus(args(undefined, { id: BC }))).rejects.toMatchObject({ code: "not_found" });
    await expect(getBroadcastStatus(args(undefined, { id: "x" }))).rejects.toMatchObject({ code: "not_found" });
    expect(db.broadcast.findFirst).toHaveBeenCalledTimes(1);
  });

  it("a draft shows the recipient count recorded at draft time", async () => {
    db.broadcast.findFirst.mockResolvedValue({ ...row, status: "draft", total: 0, variableMapping: JSON.stringify({ agent: { recipientCount: 12 } }) });
    expect((await getBroadcastStatus(args(undefined, { id: BC }))).body).toMatchObject({ recipients: 12, status: "draft" });
  });
});

// ---------------------------------------------------------------------------

describe("pause_broadcast", () => {
  const run = () => pauseBroadcast(args({}, { id: BC }));

  it("asks a running broadcast to stop, with the same logic as the Pause button", async () => {
    db.broadcast.findFirst.mockResolvedValue({ id: BC, status: "running" });
    const r = await run();
    expect(control.requestBroadcastPause).toHaveBeenCalledWith(BC, "running");
    expect(r.body).toMatchObject({ outcome: "pause_requested" });
    expect(db.broadcast.findFirst.mock.calls[0][0].where).toEqual({ id: BC, createdByUserId: "agent-user" });
  });

  it("takes a scheduled broadcast back to draft", async () => {
    db.broadcast.findFirst.mockResolvedValue({ id: BC, status: "scheduled" });
    const r = await run();
    expect(db.broadcast.updateMany).toHaveBeenCalledWith({
      where: { id: BC, status: "scheduled" },
      data: { status: "draft", scheduledAt: null },
    });
    expect(r.body).toMatchObject({ status: "draft", outcome: "schedule_cancelled" });
  });

  it("is safe to repeat, and refuses what has nothing to stop", async () => {
    db.broadcast.findFirst.mockResolvedValue({ id: BC, status: "paused" });
    expect((await run()).body).toMatchObject({ outcome: "already_stopped" });
    for (const status of ["draft", "completed", "failed"]) {
      db.broadcast.findFirst.mockResolvedValue({ id: BC, status });
      const r = await run();
      expect(r.status).toBe(409);
      expect(code(r)).toBe("not_pausable");
    }
    expect(control.requestBroadcastPause).not.toHaveBeenCalled();
  });

  it("cannot stop someone else's broadcast", async () => {
    db.broadcast.findFirst.mockResolvedValue(null);
    await expect(run()).rejects.toMatchObject({ code: "not_found" });
  });
});

// ---------------------------------------------------------------------------

describe("launch_broadcast executor: re-checks at run time", () => {
  const exec = (input: unknown = { broadcastId: BC }) =>
    launchBroadcastExecutor({ ctx: CTX, input, approvalId: "appr-1", approvedByUserId: "human-1" });

  it("launches an approved campaign that still fits, through the existing launch flow", async () => {
    const r = await exec();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: BC, status: "running", recipients: 3 });
    expect(r.recordIds).toEqual({ broadcastId: BC });
    expect(control.startBroadcast).toHaveBeenCalledTimes(1);
    expect(control.startBroadcast.mock.calls[0][0]).toBe(BC);
    // recipients, opt-outs and the limits were all read again
    expect(db.contact.findMany).toHaveBeenCalled();
    expect(db.optOut.findMany).toHaveBeenCalled();
    expect(db.setting.findUnique).toHaveBeenCalled();
  });

  it("re-reads consent and opt-outs: people who opted out after the draft are not counted", async () => {
    db.contact.findMany.mockResolvedValue([contact(1), contact(2, { allowCampaign: false }), contact(3)]);
    db.optOut.findMany.mockResolvedValue([{ phoneE164: contact(3).phone }]);
    // one person left: still fine, and the sender gets to filter again itself
    const r = await exec();
    expect(r.status).toBe(200);
    expect(control.startBroadcast).toHaveBeenCalled();
  });

  it("refuses, and sends nothing, when everybody has since opted out or withdrawn consent", async () => {
    db.contact.findMany.mockResolvedValue([contact(1), contact(2, { allowCampaign: false }), contact(3)]);
    db.optOut.findMany.mockResolvedValue([{ phoneE164: contact(1).phone }, { phoneE164: contact(3).phone }]);
    const r = await exec();
    expect(r.status).toBe(422);
    expect(code(r)).toBe("no_eligible_recipients");
    expect(control.startBroadcast).not.toHaveBeenCalled();
  });

  it("refuses when the recipient cap was lowered since the draft", async () => {
    // the cached value from drafting time must not be used
    await getCampaignLimits();
    db.setting.findUnique.mockResolvedValue({ value: JSON.stringify({ maxRecipients: 2 }) });
    const r = await exec();
    expect(code(r)).toBe("over_recipient_cap");
    expect(control.startBroadcast).not.toHaveBeenCalled();
  });

  it("refuses when other campaigns have used the day up since the draft", async () => {
    db.broadcast.findMany.mockResolvedValue([{ status: "completed", total: 499, variableMapping: "{}" }]);
    const r = await exec();
    expect(r.status).toBe(429);
    expect(code(r)).toBe("over_daily_cap");
    expect(control.startBroadcast).not.toHaveBeenCalled();
    // the campaign being launched is not counted against itself
    expect(db.broadcast.findMany.mock.calls[0][0].where.id).toEqual({ not: BC });
  });

  it("the sender's finished list is the last gate: a total over the limits is not sent", async () => {
    let verdict: boolean | undefined;
    let verdictAtLimit: boolean | undefined;
    control.startBroadcast.mockImplementation(async (_id: string, _origin: string, opts: { verifyTotal: (n: number) => Promise<boolean> }) => {
      verdictAtLimit = await opts.verifyTotal(200);
      verdict = await opts.verifyTotal(201);
      return { kind: "over_limit", total: 201 };
    });
    const r = await exec();
    expect(verdictAtLimit).toBe(true);
    expect(verdict).toBe(false);
    expect(r.status).toBe(422);
    expect(code(r)).toBe("over_limit");
  });

  it("campaigns must be saved contacts with a frozen list", async () => {
    for (const row of [
      ownBroadcast({ sourceType: "file" }),
      ownBroadcast({ sourceType: "sheet" }),
      ownBroadcast({}, { groupId: GROUP }),
      ownBroadcast({}, { selectedContactIds: [] }),
      ownBroadcast({}, { selectedContactIds: null }),
      ownBroadcast({ variableMapping: "not json" }),
    ]) {
      db.broadcast.findFirst.mockResolvedValue(row);
      const r = await exec();
      expect(code(r)).toBe("source_not_allowed");
    }
    expect(db.contact.findMany).not.toHaveBeenCalled();
    expect(control.startBroadcast).not.toHaveBeenCalled();
  });

  it("checks the template again: withdrawn, deleted or unapproved templates stop the launch", async () => {
    for (const t of [
      { id: TEMPLATE, category: "MARKETING", status: "rejected", deletedAt: null },
      { id: TEMPLATE, category: "MARKETING", status: "approved", deletedAt: new Date() },
      { id: TEMPLATE, category: "AUTHENTICATION", status: "approved", deletedAt: null },
      null,
    ]) {
      db.broadcast.findFirst.mockResolvedValue(ownBroadcast({ template: t }));
      const r = await exec();
      expect(r.status).toBe(422);
    }
    expect(control.startBroadcast).not.toHaveBeenCalled();
  });

  it("only the agent's own broadcast; only a draft or scheduled one", async () => {
    db.broadcast.findFirst.mockResolvedValue(null);
    const gone = await exec();
    expect(gone.status).toBe(404);
    expect(db.broadcast.findFirst.mock.calls[0][0].where).toEqual({ id: BC, createdByUserId: "agent-user" });
    db.broadcast.findFirst.mockResolvedValue(ownBroadcast({ status: "running" }));
    expect(code(await exec())).toBe("not_launchable");
    db.broadcast.findFirst.mockResolvedValue(ownBroadcast({ status: "completed" }));
    expect(code(await exec())).toBe("not_launchable");
    expect(control.startBroadcast).not.toHaveBeenCalled();
  });

  it("explains a launch that lost the race, and one that failed to start", async () => {
    control.startBroadcast.mockResolvedValue({ kind: "not_launchable" });
    expect(code(await exec())).toBe("not_launchable");
    control.startBroadcast.mockResolvedValue({ kind: "failed", error: new Error("boom") });
    const r = await exec();
    expect(r.status).toBe(502);
  });

  it("rejects a stored request that no longer validates", async () => {
    for (const input of [null, {}, { broadcastId: "x" }, { broadcastId: BC, contactIds: [uuid(1)] }]) {
      expect((await exec(input)).status).toBe(400);
    }
    expect(db.broadcast.findFirst).not.toHaveBeenCalled();
  });

  it("is what the registry runs for launch_broadcast", async () => {
    const r = await EXECUTORS.launch_broadcast({ ctx: CTX, input: { broadcastId: BC }, approvalId: "a", approvedByUserId: "h" });
    expect(r.status).toBe(200);
    expect(control.startBroadcast).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

describe("schedule_broadcast executor: re-checks at run time", () => {
  const FUTURE = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const exec = (input: unknown = { broadcastId: BC, scheduledAt: FUTURE }) =>
    scheduleBroadcastExecutor({ ctx: CTX, input, approvalId: "appr-1", approvedByUserId: "human-1" });

  it("schedules a draft, refreshes the recorded count, and does not send", async () => {
    db.contact.findMany.mockResolvedValue([contact(1), contact(2), contact(3, { allowCampaign: false })]);
    const r = await exec();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: BC, status: "scheduled", recipients: 2 });
    const call = db.broadcast.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: BC, createdByUserId: "agent-user", status: { in: ["draft", "scheduled"] } });
    expect(call.data.status).toBe("scheduled");
    expect(call.data.scheduledAt).toEqual(new Date(FUTURE));
    expect(JSON.parse(call.data.variableMapping).agent.recipientCount).toBe(2);
    expect(JSON.parse(call.data.variableMapping).selectedContactIds).toHaveLength(3);
    expect(control.startBroadcast).not.toHaveBeenCalled();
  });

  it("holds the time to the same window as the human screen", async () => {
    for (const at of [new Date(Date.now() + 30_000).toISOString(), new Date(Date.now() + 91 * 86_400_000).toISOString()]) {
      const r = await exec({ broadcastId: BC, scheduledAt: at });
      expect(r.status).toBe(422);
      expect(code(r)).toBe("invalid_schedule");
    }
    expect(db.broadcast.updateMany).not.toHaveBeenCalled();
  });

  it("applies the caps to the day it is scheduled for", async () => {
    db.broadcast.findMany.mockResolvedValue([{ status: "scheduled", total: 0, variableMapping: JSON.stringify({ agent: { recipientCount: 499 } }) }]);
    const r = await exec();
    expect(code(r)).toBe("over_daily_cap");
    expect(db.broadcast.updateMany).not.toHaveBeenCalled();
    const range = db.broadcast.findMany.mock.calls[0][0].where.OR[1].scheduledAt;
    expect(range.gte.getTime()).toBeLessThanOrEqual(new Date(FUTURE).getTime());
    expect(range.lte.getTime()).toBeGreaterThanOrEqual(new Date(FUTURE).getTime());
  });

  it("re-checks the recipient cap, opt-outs and contacts-only source like launch does", async () => {
    db.setting.findUnique.mockResolvedValue({ value: JSON.stringify({ maxRecipients: 1 }) });
    expect(code(await exec())).toBe("over_recipient_cap");
    db.setting.findUnique.mockResolvedValue(null);
    db.optOut.findMany.mockResolvedValue(contacts(3).map((c) => ({ phoneE164: c.phone })));
    expect(code(await exec())).toBe("no_eligible_recipients");
    db.optOut.findMany.mockResolvedValue([]);
    db.broadcast.findFirst.mockResolvedValue(ownBroadcast({ sourceType: "sheet" }));
    expect(code(await exec())).toBe("source_not_allowed");
    expect(db.broadcast.updateMany).not.toHaveBeenCalled();
  });

  it("only drafts and scheduled campaigns that are the agent's own; loses gracefully to a launch", async () => {
    db.broadcast.findFirst.mockResolvedValue(ownBroadcast({ status: "running" }));
    expect(code(await exec())).toBe("not_schedulable");
    db.broadcast.findFirst.mockResolvedValue(null);
    expect((await exec()).status).toBe(404);
    db.broadcast.findFirst.mockResolvedValue(ownBroadcast());
    db.broadcast.updateMany.mockResolvedValue({ count: 0 });
    expect(code(await exec())).toBe("not_schedulable");
  });

  it("rejects a stored request that no longer validates", async () => {
    expect((await exec({ broadcastId: BC })).status).toBe(400);
    expect((await exec({ broadcastId: BC, scheduledAt: "soon" })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe("the limits themselves", () => {
  it("defaults to 200 per campaign and 500 per day", () => {
    expect(resolveCampaignLimits(null)).toEqual({ maxRecipients: 200, maxPerDay: 500 });
    expect(resolveCampaignLimits([])).toEqual({ maxRecipients: 200, maxPerDay: 500 });
  });

  it("takes valid stored values and ignores anything else field by field", () => {
    expect(resolveCampaignLimits({ maxRecipients: 50, maxPerDay: 300 })).toEqual({ maxRecipients: 50, maxPerDay: 300 });
    expect(resolveCampaignLimits({ maxRecipients: 0, maxPerDay: "9" })).toEqual({ maxRecipients: 200, maxPerDay: 500 });
    expect(resolveCampaignLimits({ maxRecipients: 1.5, maxPerDay: 10 })).toEqual({ maxRecipients: 200, maxPerDay: 10 });
    expect(resolveCampaignLimits({ maxRecipients: 10 ** 9, maxPerDay: -1 })).toEqual({ maxRecipients: 200, maxPerDay: 500 });
  });

  it("a malformed Setting row falls back to the defaults", async () => {
    db.setting.findUnique.mockResolvedValue({ value: "{nope" });
    await expect(getCampaignLimits({ fresh: true })).resolves.toEqual({ maxRecipients: 200, maxPerDay: 500 });
  });

  it("checkCaps orders its answers: nobody, too many, too many today", () => {
    const limits = { maxRecipients: 200, maxPerDay: 500 };
    expect(checkCaps({ limits, recipients: 0, usedOnDay: 0 })?.code).toBe("no_eligible_recipients");
    expect(checkCaps({ limits, recipients: 201, usedOnDay: 0 })?.code).toBe("over_recipient_cap");
    expect(checkCaps({ limits, recipients: 100, usedOnDay: 401 })?.code).toBe("over_daily_cap");
    expect(checkCaps({ limits, recipients: 100, usedOnDay: 400 })).toBeNull();
    expect(checkCaps({ limits, recipients: 200, usedOnDay: 300 })).toBeNull();
  });

  it("the day is the India (IST) day", () => {
    const { start, end } = istDayRange(new Date("2026-10-13T20:00:00Z")); // 01:30 on the 14th in India
    expect(start.toISOString()).toBe("2026-10-13T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-14T18:29:59.999Z");
  });
});
