import { beforeEach, describe, expect, it, vi } from "vitest";

/** The website-lead tools through the real route files, withAgent and the backend writes. Prisma is mocked. */
const db = vi.hoisted(() => ({
  setting: { findUnique: vi.fn() },
  websiteLead: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  websiteLeadNote: { create: vi.fn() },
  user: { findFirst: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));

const lw = vi.hoisted(() => ({
  findActiveMetaLeadStage: vi.fn(),
  promoteLeadToCrm: vi.fn(),
  upsertMarketingContact: vi.fn(),
}));
vi.mock("@/lib/meta-ads/leadWrites", () => lw);

const badges = vi.hoisted(() => ({ getBadgesForLeads: vi.fn(), getBadgesForLead: vi.fn() }));
vi.mock("@/lib/website-leads/badges", () => badges);

const verifyCredential = vi.hoisted(() => vi.fn());
vi.mock("../keys", () => ({ verifyCredential: (...a: unknown[]) => verifyCredential(...a) }));
const writeAgentAudit = vi.hoisted(() => vi.fn());
vi.mock("../audit", () => ({ writeAgentAudit: (...a: unknown[]) => writeAgentAudit(...a) }));
const checkRateLimit = vi.hoisted(() => vi.fn());
vi.mock("../ratelimit", async () => {
  const actual = await vi.importActual<typeof import("../ratelimit")>("../ratelimit");
  return { ...actual, checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) };
});
const beginIdempotent = vi.hoisted(() => vi.fn());
vi.mock("../idempotency", async () => {
  const actual = await vi.importActual<typeof import("../idempotency")>("../idempotency");
  return { ...actual, beginIdempotent: (...a: unknown[]) => beginIdempotent(...a), completeIdempotent: vi.fn(), failIdempotent: vi.fn() };
});

import { resetOverridesCache } from "../permissions";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEAD = uuid(1);
const AGENT_USER = "agent-user";

const req = (method: string, url: string, body?: unknown, key: string | null = "idem-key-0001") =>
  new Request(`https://app.test${url}`, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const lastAudit = () => writeAgentAudit.mock.calls.at(-1)![0] as Record<string, unknown>;
const json = async (res: Response) => (await res.json()) as Record<string, any>;

const row = (over: Record<string, unknown> = {}) => ({
  id: LEAD,
  name: "Asha Rao",
  phone: "+91 98765 43210",
  normalizedPhone: "919876543210",
  email: "asha@example.com",
  city: "Pune",
  state: "Maharashtra",
  sport: "Football",
  areaSqft: 6000,
  lengthFt: 100,
  widthFt: 60,
  startWhen: "Within a month",
  stage: "NEW",
  assignedToUserId: "rep-1",
  accountContactId: null,
  contactId: null,
  receivedAt: new Date("2026-10-16T08:30:00Z"),
  assignedTo: { name: "Ravi Sales" },
  labels: [{ label: { id: "lab-1", name: "Hot", color: "#f00" } }],
  ...over,
});

const INTERNAL = [
  "normalizedPhone",
  "assignedToUserId",
  "accountContactId",
  "contactId",
  "userAgent",
  "websiteLeadId",
  "authorUserId",
  "deletedAt",
  "removedAt",
  "source",
  "color",
];
const keysDeep = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  }
  return out;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetOverridesCache();
  verifyCredential.mockResolvedValue({
    ok: true,
    context: { identityId: "idn-1", userId: AGENT_USER, credentialId: "cred-1", environment: "staging", ip: null },
    meta: { identityName: "Agent", credentialLabel: "l", keyPrefix: "fvai_stg_x", expiresAt: null },
  });
  writeAgentAudit.mockResolvedValue({});
  checkRateLimit.mockResolvedValue({ allowed: true });
  beginIdempotent.mockResolvedValue({ kind: "execute" });
  db.setting.findUnique.mockResolvedValue(null);
  badges.getBadgesForLeads.mockResolvedValue(new Map());
  badges.getBadgesForLead.mockResolvedValue([]);
  lw.findActiveMetaLeadStage.mockResolvedValue({ slug: "QUALIFIED" });
});

describe("list_website_leads", () => {
  const list = async (qs = "") => (await import("@/app/api/agent/v1/website-leads/route")).GET(req("GET", `/api/agent/v1/website-leads${qs}`, undefined, null));

  it("returns a minimal row with the fields a salesperson needs, and the badges", async () => {
    db.websiteLead.count.mockResolvedValue(1);
    db.websiteLead.findMany.mockResolvedValue([row()]);
    badges.getBadgesForLeads.mockResolvedValue(new Map([[LEAD, [{ kind: "crm", label: "Already in CRM", id: uuid(7) }]]]));

    const res = await list();
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({
      items: [
        {
          id: LEAD,
          name: "Asha Rao",
          phone: "+91 98765 43210",
          email: "asha@example.com",
          city: "Pune",
          state: "Maharashtra",
          sport: "Football",
          size: { areaSqft: 6000, lengthFt: 100, widthFt: 60 },
          startTime: "Within a month",
          stage: "NEW",
          labels: ["Hot"],
          assignedTo: "Ravi Sales",
          inCrm: false,
          receivedAt: "2026-10-16T08:30:00.000Z",
          badges: [{ kind: "crm", label: "Already in CRM", id: uuid(7) }],
        },
      ],
      total: 1,
      page: 1,
      pageCount: 1,
      limit: 20,
    });
    const seen = keysDeep(body);
    for (const k of INTERNAL) expect(seen.has(k), k).toBe(false);
    expect(lastAudit()).toMatchObject({ toolName: "list_website_leads", action: "read", result: "success", recordIds: [LEAD] });
  });

  it("pages by limit and passes the filters to the same query the Website Leads page uses", async () => {
    db.websiteLead.count.mockResolvedValue(0);
    db.websiteLead.findMany.mockResolvedValue([]);
    const res = await list("?limit=5&page=1&city=Pune&assigned=unassigned&stage=NEW&areaMin=1000&q=asha&from=2026-10-01&to=2026-10-31");
    expect(res.status).toBe(200);
    const args = db.websiteLead.findMany.mock.calls[0][0];
    expect(args.take).toBe(5);
    expect(args.skip).toBe(0);
    const and = args.where.AND as Record<string, unknown>[];
    expect(and[0]).toEqual({ deletedAt: null });
    expect(and).toEqual(
      expect.arrayContaining([
        { city: { contains: "Pune", mode: "insensitive" } },
        { stage: "NEW" },
        { assignedToUserId: null },
        { areaSqft: { gte: 1000 } },
      ]),
    );
    expect((await json(res)).limit).toBe(5);
  });

  it("selects no internal column from the database", async () => {
    db.websiteLead.count.mockResolvedValue(0);
    db.websiteLead.findMany.mockResolvedValue([]);
    await list();
    const select = db.websiteLead.findMany.mock.calls[0][0].select as Record<string, unknown>;
    expect(select.userAgent).toBeUndefined();
    expect(select.websiteLeadId).toBeUndefined();
    expect(select.deletedAt).toBeUndefined();
  });

  it("never lists removed leads: a removed flag in the query is dropped and the query stays on live leads", async () => {
    db.websiteLead.count.mockResolvedValue(0);
    db.websiteLead.findMany.mockResolvedValue([]);
    const res = await list("?removed=1");
    expect(res.status).toBe(200);
    const args = db.websiteLead.findMany.mock.calls[0][0];
    expect(args.where.AND[0]).toEqual({ deletedAt: null });
    expect(args.select.deletedAt).toBeUndefined();
    expect(db.websiteLead.count.mock.calls[0][0].where.AND[0]).toEqual({ deletedAt: null });
  });

  it("builds its filters without the removed flag, whatever the input carries", async () => {
    const { websiteLeadFilters } = await import("../website/read");
    const filters = websiteLeadFilters({ city: "Pune", removed: true } as never);
    expect(filters.city).toBe("Pune");
    expect("removed" in filters).toBe(false);
  });

  it("rejects limit 101 and a reversed date range before any query", async () => {
    const tooMany = await list("?limit=101");
    expect(tooMany.status).toBe(400);
    expect((await json(tooMany)).error.message).toMatch(/limit/);
    expect((await list("?from=2026-10-31&to=2026-10-01")).status).toBe(400);
    expect(db.websiteLead.findMany).not.toHaveBeenCalled();
  });
});

describe("get_website_lead", () => {
  const get = async (id: string) =>
    (await import("@/app/api/agent/v1/website-leads/[id]/route")).GET(req("GET", `/api/agent/v1/website-leads/${id}`, undefined, null), { params: { id } });

  const detail = () => ({
    ...row({ accountContactId: uuid(8), contactId: uuid(9) }),
    jobTitle: "Principal",
    notes: "We want a turf for the school ground",
    answers: [
      { key: "q1", label: "Do you have a plot?", value: "Yes" },
      { key: "q2", label: "Budget", value: "10-15 lakh" },
    ],
    surface: "turf",
    env: "school",
    source: "fitoverse.com/build",
    internalNotes: [{ id: uuid(20), body: "Called, will revert", createdAt: new Date("2026-10-17T05:00:00Z"), authorUserId: "rep-1", author: { name: "Ravi Sales" } }],
  });

  it("returns every useful field, the form answers, badges, notes and stage, without internal ones", async () => {
    db.websiteLead.findFirst.mockResolvedValue(detail());
    badges.getBadgesForLead.mockResolvedValue([{ kind: "ad_lead", label: "Also an ad lead", id: uuid(30) }]);
    const res = await get(LEAD);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      id: LEAD,
      name: "Asha Rao",
      stage: "NEW",
      assignedTo: "Ravi Sales",
      inCrm: true,
      inMarketing: true,
      jobTitle: "Principal",
      customerMessage: "We want a turf for the school ground",
      formAnswers: [
        { name: "Do you have a plot?", value: "Yes" },
        { name: "Budget", value: "10-15 lakh" },
      ],
      surface: "turf",
      courtEnvironment: "school",
      badges: [{ kind: "ad_lead", label: "Also an ad lead", id: uuid(30) }],
      notes: [{ id: uuid(20), body: "Called, will revert", author: "Ravi Sales", createdAt: "2026-10-17T05:00:00.000Z" }],
    });
    const seen = keysDeep(body);
    for (const k of INTERNAL) expect(seen.has(k), k).toBe(false);
    const select = db.websiteLead.findFirst.mock.calls[0][0].select as Record<string, unknown>;
    expect(select.userAgent).toBeUndefined();
    expect(select.websiteLeadId).toBeUndefined();
    expect(db.websiteLead.findFirst.mock.calls[0][0].where).toEqual({ id: LEAD, deletedAt: null });
  });

  it("404s a removed lead: the agent's query only ever matches live leads", async () => {
    // A database that returns the lead only when the query does not filter out removed ones.
    db.websiteLead.findFirst.mockImplementation(async ({ where }: { where: { deletedAt?: unknown } }) =>
      where.deletedAt === null ? null : { ...detail(), deletedAt: new Date("2026-10-20T08:15:00Z") },
    );
    const res = await get(LEAD);
    expect(res.status).toBe(404);
    expect(db.websiteLead.findFirst.mock.calls[0][0].where).toEqual({ id: LEAD, deletedAt: null });
    expect(db.websiteLead.findFirst.mock.calls[0][0].select.deletedAt).toBeUndefined();
  });

  it("404s an unknown lead, and a malformed id without asking the database", async () => {
    db.websiteLead.findFirst.mockResolvedValue(null);
    expect((await get(LEAD)).status).toBe(404);
    db.websiteLead.findFirst.mockClear();
    expect((await get("xyz")).status).toBe(404);
    expect(db.websiteLead.findFirst).not.toHaveBeenCalled();
  });
});

describe("set_website_lead_stage", () => {
  const post = async (body: unknown, id = LEAD, key: string | null = "idem-key-0001") =>
    (await import("@/app/api/agent/v1/website-leads/[id]/stage/route")).POST(req("POST", `/api/agent/v1/website-leads/${id}/stage`, body, key), { params: { id } });

  it("sets an active stage and reports only the field that changed", async () => {
    db.websiteLead.updateMany.mockResolvedValue({ count: 1 });
    const res = await post({ stage: "QUALIFIED" });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ id: LEAD, stage: "QUALIFIED" });
    expect(lw.findActiveMetaLeadStage).toHaveBeenCalledWith("QUALIFIED");
    // Only the stage is written: never the rep.
    expect(db.websiteLead.updateMany).toHaveBeenCalledWith({ where: { id: LEAD, deletedAt: null }, data: { stage: "QUALIFIED" } });
    expect(lastAudit()).toMatchObject({ toolName: "set_website_lead_stage", action: "update", result: "success", recordIds: [LEAD], fieldsChanged: ["stage"] });
  });

  it("refuses a stage that is not in the active MetaLeadStage list and writes nothing", async () => {
    lw.findActiveMetaLeadStage.mockResolvedValue(null);
    const res = await post({ stage: "MADE_UP" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatchObject({ code: "invalid_input", message: "Unknown or inactive stage." });
    expect(db.websiteLead.updateMany).not.toHaveBeenCalled();
  });

  it("404s a lead that does not exist", async () => {
    db.websiteLead.updateMany.mockResolvedValue({ count: 0 });
    expect((await post({ stage: "QUALIFIED" })).status).toBe(404);
  });

  it("cannot be used to assign: a rep in the body is a 400 and nothing is written", async () => {
    const res = await post({ stage: "QUALIFIED", assignedToUserId: uuid(5) });
    expect(res.status).toBe(400);
    expect(db.websiteLead.updateMany).not.toHaveBeenCalled();
  });

  it("needs an Idempotency-Key, and takes the lead id from the URL, never the body", async () => {
    expect((await post({ stage: "QUALIFIED" }, LEAD, null)).status).toBe(400);
    expect(db.websiteLead.updateMany).not.toHaveBeenCalled();
    db.websiteLead.updateMany.mockResolvedValue({ count: 1 });
    const res = await post({ stage: "QUALIFIED", websiteLeadId: uuid(99) });
    expect(res.status).toBe(200);
    expect(db.websiteLead.updateMany.mock.calls[0][0].where.id).toBe(LEAD);
  });
});

describe("add_website_lead_note", () => {
  const post = async (body: unknown, id = LEAD) =>
    (await import("@/app/api/agent/v1/website-leads/[id]/notes/route")).POST(req("POST", `/api/agent/v1/website-leads/${id}/notes`, body), { params: { id } });

  it("authors the note as the AI service user and returns only its id and time", async () => {
    db.websiteLead.findFirst.mockResolvedValue({ id: LEAD });
    db.websiteLeadNote.create.mockResolvedValue({
      id: uuid(40),
      body: "Wants a site visit",
      createdAt: new Date("2026-10-17T06:00:00Z"),
      authorUserId: AGENT_USER,
      author: { name: "AI Sales Agent" },
    });
    const res = await post({ body: "  Wants a site visit  " });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ note: { id: uuid(40), createdAt: "2026-10-17T06:00:00.000Z" } });
    expect(db.websiteLeadNote.create.mock.calls[0][0].data).toEqual({ websiteLeadId: LEAD, authorUserId: AGENT_USER, body: "Wants a site visit" });
    expect(lastAudit()).toMatchObject({ toolName: "add_website_lead_note", action: "create", recordIds: [LEAD, uuid(40)] });
  });

  it("cannot name another author", async () => {
    const res = await post({ body: "hi", authorUserId: uuid(6) });
    expect(res.status).toBe(400);
    expect(db.websiteLeadNote.create).not.toHaveBeenCalled();
  });

  it("accepts 5000 characters and refuses 5001, empty and whitespace-only notes", async () => {
    db.websiteLead.findFirst.mockResolvedValue({ id: LEAD });
    db.websiteLeadNote.create.mockResolvedValue({ id: uuid(41), body: "x", createdAt: new Date(), authorUserId: AGENT_USER, author: { name: "AI" } });
    expect((await post({ body: "x".repeat(5000) })).status).toBe(200);
    db.websiteLeadNote.create.mockClear();
    expect((await post({ body: "x".repeat(5001) })).status).toBe(400);
    expect((await post({ body: "" })).status).toBe(400);
    expect((await post({ body: "   " })).status).toBe(400);
    expect(db.websiteLeadNote.create).not.toHaveBeenCalled();
  });

  it("404s a lead that does not exist and writes nothing", async () => {
    db.websiteLead.findFirst.mockResolvedValue(null);
    expect((await post({ body: "hi" })).status).toBe(404);
    expect(db.websiteLeadNote.create).not.toHaveBeenCalled();
  });
});

describe("move_website_lead_to_crm", () => {
  const post = async (body: unknown = {}, id = LEAD) =>
    (await import("@/app/api/agent/v1/website-leads/[id]/move-to-crm/route")).POST(req("POST", `/api/agent/v1/website-leads/${id}/move-to-crm`, body), { params: { id } });

  const lead = (over: Record<string, unknown> = {}) => ({
    id: LEAD,
    name: "Asha Rao",
    phone: "+91 98765 43210",
    normalizedPhone: "919876543210",
    email: "asha@example.com",
    city: "Pune",
    accountContactId: null,
    ...over,
  });

  it("moves the lead into the CRM UNASSIGNED, attributed to the AI and the website source", async () => {
    db.websiteLead.findFirst.mockResolvedValue(lead());
    lw.promoteLeadToCrm.mockResolvedValue({ kind: "ok", accountContactId: uuid(50), leadSourceId: "src-1", matchedExisting: false });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ accountContactId: uuid(50), alreadyLinked: false, matchedExisting: false });
    const call = lw.promoteLeadToCrm.mock.calls[0][0];
    expect(call.ownerUserId).toBeNull();
    expect(call.actorUserId).toBe(AGENT_USER);
    expect(call.leadSourceSlug).toBe("website");
    expect(call.lead).toEqual({ name: "Asha Rao", phone: "+91 98765 43210", normalizedPhone: "919876543210", email: "asha@example.com", city: "Pune" });
    expect(lastAudit()).toMatchObject({ toolName: "move_website_lead_to_crm", action: "create", recordIds: [LEAD, uuid(50)] });
  });

  it("de-duplicates by phone the way the backend does: it reports a reused contact", async () => {
    db.websiteLead.findFirst.mockResolvedValue(lead());
    lw.promoteLeadToCrm.mockResolvedValue({ kind: "ok", accountContactId: uuid(51), leadSourceId: null, matchedExisting: true });
    expect(await json(await post())).toEqual({ accountContactId: uuid(51), alreadyLinked: false, matchedExisting: true });
    expect(lw.promoteLeadToCrm.mock.calls[0][0].ownerUserId).toBeNull();
  });

  it("is safe to repeat: an already-moved lead returns its link and creates nothing", async () => {
    db.websiteLead.findFirst.mockResolvedValue(lead({ accountContactId: uuid(52) }));
    const res = await post();
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ accountContactId: uuid(52), alreadyLinked: true, matchedExisting: false });
    expect(lw.promoteLeadToCrm).not.toHaveBeenCalled();
  });

  it("cannot choose an owner, whatever the body says", async () => {
    db.websiteLead.findFirst.mockResolvedValue(lead());
    for (const body of [{ ownerUserId: uuid(5) }, { owner: uuid(5) }, { assignedToUserId: uuid(5) }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(lw.promoteLeadToCrm).not.toHaveBeenCalled();
  });

  it("404s a lead that does not exist", async () => {
    db.websiteLead.findFirst.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(lw.promoteLeadToCrm).not.toHaveBeenCalled();
  });
});

describe("permissions at the door", () => {
  it("an admin override to NEVER stops a write before it runs", async () => {
    db.setting.findUnique.mockResolvedValue({ value: JSON.stringify({ set_website_lead_stage: "NEVER" }) });
    const { POST } = await import("@/app/api/agent/v1/website-leads/[id]/stage/route");
    const res = await POST(req("POST", `/api/agent/v1/website-leads/${LEAD}/stage`, { stage: "QUALIFIED" }), { params: { id: LEAD } });
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("never_allowed");
    expect(db.websiteLead.updateMany).not.toHaveBeenCalled();
  });
});
