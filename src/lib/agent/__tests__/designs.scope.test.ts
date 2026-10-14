import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  courtImage: { findMany: vi.fn(), findFirst: vi.fn() },
  conversation: { findUnique: vi.fn() },
  contact: { findUnique: vi.fn() },
  accountContact: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));
const links = vi.hoisted(() => ({ contactsMatchingPhone: vi.fn() }));
vi.mock("@/lib/crm/contactLinks", () => links);
const list = vi.hoisted(() => ({ sportsByCourtImageId: vi.fn() }));
vi.mock("@/lib/court-image/list", () => list);
const create = vi.hoisted(() => ({ createCourtImageRow: vi.fn() }));
vi.mock("@/lib/court-image/create", () => create);

import { effectiveTable, effectiveVerdict, TOOL_REGISTRY } from "../permissions";
import { ROUTES, TOOLS } from "../registry/documents";
import { designIdsForPhone, designScope, resolveDesignCustomer } from "../designs/customer";
import { createDesignDraft, NEEDS_DRAWING_NOTE } from "../designs/create";
import { getDesign, layoutSummary, listDesigns } from "../designs/reads";
import {
  createDesignDraftBodySchema,
  getDesignQuery,
  listDesignsQuery,
  sendDesignBodySchema,
} from "../schemas/documents";
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
const LEAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DESIGN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

const designRow = (over: Record<string, unknown> = {}) => ({
  id: DESIGN,
  number: "FIT-CIM-2026-001",
  customerName: "Rahul Verma",
  status: "draft",
  imageUrl: null,
  image2dUrl: "https://blob.test/secret-2d.png",
  image3dUrl: null,
  video3dUrl: "https://blob.test/secret-3d.mp4",
  dealId: null,
  sentAt: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  updatedAt: new Date("2026-10-02T10:00:00Z"),
  createdByUserId: "staff-1",
  caption: "Staff wrote: only Rs 5 lakh this week",
  layout: JSON.stringify({ v: 1, plot: { lengthFt: 100, widthFt: 60 }, sports: ["football"], elements: [{ big: "x".repeat(50) }], style: {} }),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.accountContact.findUnique.mockResolvedValue({
    id: LEAD,
    name: "Rahul Verma",
    phone: "+91 98765 43210",
    deletedAt: null,
    account: { name: "Verma Sports", deletedAt: null },
  });
  db.conversation.findUnique.mockResolvedValue({ id: CONVO, contactPhone: "919876543210", contactName: "Rahul" });
  db.contact.findUnique.mockResolvedValue({ accountContactId: LEAD });
  db.$queryRaw.mockResolvedValue([]);
  db.courtImage.findMany.mockResolvedValue([designRow()]);
  db.courtImage.findFirst.mockResolvedValue(designRow());
  links.contactsMatchingPhone.mockResolvedValue([]);
  list.sportsByCourtImageId.mockResolvedValue(new Map([[DESIGN, ["football"]]]));
  create.createCourtImageRow.mockImplementation(async (d: Record<string, unknown>) =>
    designRow({
      id: "new-design",
      number: "FIT-CIM-2026-002",
      customerName: d.customerName,
      status: "draft",
      image2dUrl: null,
      video3dUrl: null,
      createdByUserId: d.createdByUserId,
    }),
  );
});

describe("design registry", () => {
  it("registers the agreed verdicts", () => {
    const want: Record<string, string> = {
      list_designs: "ALLOWED",
      get_design: "ALLOWED",
      create_design_draft: "ALLOWED",
      send_design: "ALLOWED",
      email_design_any_address: "NEVER",
      send_design_combined_pdf_unchecked: "NEVER",
    };
    expect(Object.keys(TOOLS).sort()).toEqual(Object.keys(want).sort());
    const table = effectiveTable({});
    for (const [tool, verdict] of Object.entries(want)) expect(table[tool], tool).toBe(verdict);
    expect(TOOLS.send_design.action).toBe("send");
    expect(TOOLS.list_designs.action).toBe("read");
  });

  it("the two NEVER tools cannot be loosened and have no route", () => {
    for (const t of ["email_design_any_address", "send_design_combined_pdf_unchecked"]) {
      expect(TOOLS[t]).toMatchObject({ default: "NEVER", neverLoosen: true });
      expect(effectiveVerdict(t, { [t]: "ALLOWED" })).toBe("NEVER");
      expect(effectiveVerdict(t, { [t]: "APPROVAL" })).toBe("NEVER");
      expect(ROUTES.some((r) => r.tool === t)).toBe(false);
      expect(TOOL_REGISTRY[t]).toBeDefined();
    }
  });

  it("builds no document tools yet: only the design tools exist in this area", () => {
    expect(Object.keys(TOOLS).filter((t) => /quote|quotation|pdf|document/.test(t) && t !== "send_design_combined_pdf_unchecked")).toEqual([]);
  });

  it("every design route has a route.ts wrapping its tool in withAgent", () => {
    expect(ROUTES.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "get /court-designs",
      "get /court-designs/{id}",
      "post /court-designs",
      "post /court-designs/{id}/send",
    ]);
    for (const r of ROUTES) {
      const file = path.join(ROOT, "src/app/api/agent/v1", r.path.replace(/\{id\}/g, "[id]"), "route.ts");
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8"), file).toContain(`withAgent("${r.tool}"`);
    }
  });
});

describe("request schemas", () => {
  it("reads need exactly one customer", () => {
    expect(listDesignsQuery.safeParse({ leadId: LEAD }).success).toBe(true);
    expect(listDesignsQuery.safeParse({ conversationId: CONVO, limit: "5" }).success).toBe(true);
    expect(listDesignsQuery.safeParse({}).success).toBe(false);
    expect(listDesignsQuery.safeParse({ leadId: LEAD, conversationId: CONVO }).success).toBe(false);
    expect(listDesignsQuery.safeParse({ leadId: LEAD, limit: "26" }).success).toBe(false);
    expect(getDesignQuery.safeParse({}).success).toBe(false);
    expect(getDesignQuery.safeParse({ leadId: "not-an-id" }).success).toBe(false);
  });

  it("create takes the customer, sport and size only: no pictures, layout or phone", () => {
    const ok = { leadId: LEAD, sport: "football", lengthFt: 100, widthFt: 60 };
    expect(createDesignDraftBodySchema.safeParse(ok).success).toBe(true);
    expect(createDesignDraftBodySchema.safeParse({ ...ok, leadId: undefined, conversationId: CONVO, title: "Turf" }).success).toBe(true);
    for (const extra of [
      { imageUrl: "https://x.test/a.png" },
      { image2dUrl: "https://x.test/a.png" },
      { image3dUrl: "https://x.test/a.png" },
      { video3dUrl: "https://x.test/a.mp4" },
      { layout: { v: 1 } },
      { contactPhone: "919999999999" },
      { phone: "919999999999" },
      { caption: "hi" },
      { customerName: "Someone else" },
      { dealId: OTHER },
    ]) {
      expect(createDesignDraftBodySchema.safeParse({ ...ok, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    for (const bad of [
      { sport: "chess" },
      { lengthFt: 9 },
      { widthFt: 2001 },
      { lengthFt: "100" },
      { leadId: undefined },
      { conversationId: CONVO },
    ]) {
      expect(createDesignDraftBodySchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("send takes formats only", () => {
    expect(sendDesignBodySchema.safeParse({ formats: ["2d", "3d-video"] }).success).toBe(true);
    for (const bad of [
      {},
      { formats: [] },
      { formats: ["pdf"] },
      { formats: ["2d", "2d"] },
      { formats: ["2d"], to: "919999999999" },
      { formats: ["2d"], phone: "919999999999" },
      { formats: ["2d"], contactPhone: "919999999999" },
      { formats: ["2d"], conversationId: CONVO },
      { formats: ["2d"], email: "a@b.com" },
    ]) {
      expect(sendDesignBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("customer scoping", () => {
  it("a lead is found by its contact link, its chat, and its phone (in any format)", async () => {
    db.$queryRaw.mockResolvedValue([
      { id: "by-phone-1", contact_phone: "+91 98765 43210" },
      { id: "by-phone-2", contact_phone: "09876543210" },
      { id: "different-person", contact_phone: "+44 7000 543210" }, // same last digits, other country
    ]);
    const customer = await resolveDesignCustomer({ leadId: LEAD });
    expect(customer).toEqual({ accountContactId: LEAD, conversationId: CONVO, phone: "919876543210", name: "Rahul Verma" });
    const scope = await designScope(customer);
    expect(scope).toEqual({
      OR: [{ accountContactId: LEAD }, { conversationId: CONVO }, { id: { in: ["by-phone-1", "by-phone-2"] } }],
    });
  });

  it("a conversation resolves to the CRM person behind it", async () => {
    const customer = await resolveDesignCustomer({ conversationId: CONVO });
    expect(customer).toMatchObject({ accountContactId: LEAD, conversationId: CONVO, phone: "919876543210", name: "Rahul" });
    // no linked marketing contact: fall back to the one live CRM contact with that number
    db.contact.findUnique.mockResolvedValue(null);
    links.contactsMatchingPhone.mockResolvedValue([{ id: OTHER, phone: "9876543210" }]);
    expect((await resolveDesignCustomer({ conversationId: CONVO })).accountContactId).toBe(OTHER);
    // two people share the number: link to neither
    links.contactsMatchingPhone.mockResolvedValue([{ id: OTHER, phone: "x" }, { id: LEAD, phone: "y" }]);
    expect((await resolveDesignCustomer({ conversationId: CONVO })).accountContactId).toBeNull();
  });

  it("the phone match compares digits (last ten) first, then the full normalised number", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "x", contact_phone: "98765 43210" }]);
    await expect(designIdsForPhone("919876543210")).resolves.toEqual(["x"]);
    expect(db.$queryRaw.mock.calls[0].slice(1)).toEqual(["9876543210"]);
    await expect(designIdsForPhone("12345")).resolves.toEqual([]);
  });

  it("unknown or deleted customers are 404", async () => {
    db.accountContact.findUnique.mockResolvedValue(null);
    await expect(resolveDesignCustomer({ leadId: LEAD })).rejects.toMatchObject({ code: "not_found" });
    db.accountContact.findUnique.mockResolvedValue({ id: LEAD, name: "x", phone: null, deletedAt: new Date(), account: { name: "a", deletedAt: null } });
    await expect(resolveDesignCustomer({ leadId: LEAD })).rejects.toMatchObject({ code: "not_found" });
    db.conversation.findUnique.mockResolvedValue(null);
    await expect(resolveDesignCustomer({ conversationId: CONVO })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("list_designs", () => {
  it("lists only the named customer's designs, newest first", async () => {
    const r = await listDesigns(args(listDesignsQuery.parse({ leadId: LEAD })));
    const q = db.courtImage.findMany.mock.calls[0][0];
    expect(q.where.OR).toEqual(expect.arrayContaining([{ accountContactId: LEAD }, { conversationId: CONVO }]));
    expect(q.orderBy).toEqual({ createdAt: "desc" });
    expect(q.take).toBe(10);
    expect((r.body as { designs: unknown[] }).designs).toHaveLength(1);
  });

  it("returns metadata and which formats exist, and nothing to download or read", async () => {
    const r = await listDesigns(args(listDesignsQuery.parse({ conversationId: CONVO })));
    const design = (r.body as { designs: Record<string, unknown>[] }).designs[0];
    expect(design).toMatchObject({
      id: DESIGN,
      number: "FIT-CIM-2026-001",
      sports: ["football"],
      formats: { twoD: true, threeDImage: false, threeDVideo: true },
      needsDrawing: false,
      createdBy: "staff",
    });
    const json = JSON.stringify(r.body);
    expect(json).not.toContain("blob.test");
    expect(json).not.toContain("elements");
    expect(json).not.toContain("only Rs 5 lakh");
    expect(Object.keys(design)).not.toEqual(expect.arrayContaining(["layout", "caption", "imageUrl", "contactPhone"]));
  });

  it("marks a design with no pictures as needing a person to draw it, and the AI's own as ai_agent", async () => {
    db.courtImage.findMany.mockResolvedValue([designRow({ image2dUrl: null, video3dUrl: null, createdByUserId: "agent-user" })]);
    const d = ((await listDesigns(args(listDesignsQuery.parse({ leadId: LEAD })))).body as { designs: Record<string, unknown>[] }).designs[0];
    expect(d).toMatchObject({ needsDrawing: true, createdBy: "ai_agent", formats: { twoD: false, threeDImage: false, threeDVideo: false } });
  });

  it("the legacy primary imageUrl counts as the 2D plan", async () => {
    db.courtImage.findMany.mockResolvedValue([designRow({ imageUrl: "https://blob.test/p.png", image2dUrl: null, video3dUrl: null })]);
    const d = ((await listDesigns(args(listDesignsQuery.parse({ leadId: LEAD })))).body as { designs: Record<string, unknown>[] }).designs[0];
    expect(d.formats).toMatchObject({ twoD: true });
  });
});

describe("get_design", () => {
  const get = (q: Record<string, string>, id = DESIGN) => getDesign(args(getDesignQuery.parse(q), { id }));

  it("returns it only when it belongs to the named customer, with plot size from the layout", async () => {
    const r = await get({ leadId: LEAD });
    const where = db.courtImage.findFirst.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ id: DESIGN });
    expect(where.AND[1].OR).toEqual(expect.arrayContaining([{ accountContactId: LEAD }, { conversationId: CONVO }]));
    expect(r.body).toMatchObject({ design: { id: DESIGN, sports: ["football"], plot: { lengthFt: 100, widthFt: 60 } } });
    expect(JSON.stringify(r.body)).not.toContain("elements");
  });

  it("another customer's design looks exactly like no design", async () => {
    db.courtImage.findFirst.mockResolvedValue(null);
    await expect(get({ leadId: LEAD }, OTHER)).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("a malformed id never reaches the database", async () => {
    await expect(get({ leadId: LEAD }, "nope")).rejects.toMatchObject({ code: "not_found" });
    expect(db.courtImage.findFirst).not.toHaveBeenCalled();
  });

  it("copes with an unreadable layout", () => {
    expect(layoutSummary("not json")).toEqual({ sports: [], plot: null });
    expect(layoutSummary(JSON.stringify({ sports: ["x", 3], plot: { lengthFt: "a" } }))).toEqual({ sports: ["x"], plot: null });
  });
});

describe("create_design_draft", () => {
  const body = (over: Record<string, unknown> = {}) =>
    createDesignDraftBodySchema.parse({ leadId: LEAD, sport: "football", lengthFt: 100, widthFt: 60, ...over });

  it("creates an empty draft for the customer and says a team member must draw it", async () => {
    const r = await createDesignDraft(args(body()));
    expect(create.createCourtImageRow).toHaveBeenCalledTimes(1);
    const data = create.createCourtImageRow.mock.calls[0][0];
    expect(data).toMatchObject({
      customerName: "Rahul Verma",
      createdByUserId: "agent-user",
      accountContactId: LEAD,
      conversationId: CONVO,
      contactPhone: "919876543210",
    });
    // the layout has the plot and sport the AI asked for, and no pictures exist
    const layout = JSON.parse(data.layout);
    expect(layout).toMatchObject({ v: 1, plot: { lengthFt: 100, widthFt: 60 }, sports: ["football"] });
    for (const picture of ["imageUrl", "image2dUrl", "image3dUrl", "video3dUrl", "dealId"]) expect(data[picture]).toBeUndefined();
    expect(r.body).toMatchObject({
      design: { id: "new-design", createdBy: "ai_agent", needsDrawing: true, formats: { twoD: false, threeDImage: false, threeDVideo: false }, plot: { lengthFt: 100, widthFt: 60 } },
      note: NEEDS_DRAWING_NOTE,
    });
    expect(NEEDS_DRAWING_NOTE).toMatch(/team member/);
  });

  it("the customer comes from the lead or the chat, never a typed phone", async () => {
    await createDesignDraft(args(body({ leadId: undefined, conversationId: CONVO })));
    const data = create.createCourtImageRow.mock.calls[0][0];
    expect(data).toMatchObject({ conversationId: CONVO, contactPhone: "919876543210", accountContactId: LEAD });
  });

  it("fails clearly when a design number cannot be assigned", async () => {
    create.createCourtImageRow.mockResolvedValue(null);
    await expect(createDesignDraft(args(body()))).rejects.toMatchObject({ code: "internal", status: 503 });
  });
});
