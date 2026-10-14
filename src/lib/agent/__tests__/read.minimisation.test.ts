import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { isAdmin, isManagerOrAbove } from "@/lib/rbac";
import type { TimelineEntry } from "@/lib/crm/timelineShared";
import type { MetaLeadDetail } from "@/lib/meta-ads/queries";
import type { ProductDTO } from "@/lib/products/store";
import { AGENT_ANALYTICS_SCOPE } from "../read/analytics";
import { shapeKpiBoard, stripInternalKeys, toOpenDealRow } from "../read/analyticsShape";
import { toAgentAdLeadDetail } from "../read/adLeads";
import { toAgentProduct } from "../read/catalogue";
import { toDealRow } from "../read/deals";
import { filterAgentTimeline, toLeadDetail, toLeadRow, toTimelineItem, AGENT_TIMELINE_VIEWER } from "../read/leads";
import { phoneLast4 } from "../read/shared";
import { canSeeContactEvent, insightVisibility } from "@/lib/crm/contactEvents";

// Strings that must never appear anywhere in what the agent receives.
const FORBIDDEN = [
  "SECRET-INSIGHT-BODY",
  "https://blob.example/attachment.pdf",
  "https://blob.example/tds.pdf",
  "TOTAL-COST-12345",
  "hunter2-password-hash",
  "TOKEN-abc123",
  "PRIVATE-AUTHOR-ID",
];
const expectClean = (value: unknown) => {
  const json = JSON.stringify(value);
  for (const f of FORBIDDEN) expect(json, f).not.toContain(f);
};

const D = new Date("2026-09-01T10:00:00.000Z");

describe("get_lead mapper", () => {
  // The source object deliberately carries everything a careless query could pull in.
  const source = {
    contact: {
      id: "c1",
      name: " Asha Rao ",
      phone: "+919876543210",
      email: "asha@example.com",
      designation: "Director",
      notes: "Prefers calls after 5pm",
      fields: JSON.stringify({ plot: "Hosur", budget: 500000 }),
      pipelineStage: "LEAD",
      promotedToLeadAt: D,
      createdAt: D,
      leadStage: { id: "s1", name: "Quoted", colorHex: "#fff" },
      leadSource: { name: "Meta Ads", slug: "meta" },
      account: {
        id: "a1",
        name: "Rao Sports ",
        city: "Hosur",
        businessType: "B2C",
        gstin: "29ABCDE1234F1Z5",
        customerProfile: { name: "Academy" },
        owner: { id: "u1", name: "Priya ", email: "priya@fitoverse.test", passwordHash: "hunter2-password-hash" },
      },
      insights: [{ body: "SECRET-INSIGHT-BODY", authorUserId: "PRIVATE-AUTHOR-ID" }],
      attachments: [{ fileName: "id-proof.pdf", fileUrl: "https://blob.example/attachment.pdf" }],
    },
    lastActivityAt: D,
    notes: [{ id: "n1", title: null, body: "Called, wants turf", createdAt: D, author: { name: "Priya", token: "TOKEN-abc123" } }],
    nextActions: [{ id: "na1", text: "Send quote", dueAt: D, reminderId: "r1" }],
    tasks: [{ id: "t1", message: "Follow up", dueAt: D, priority: "HIGH", ownerUserId: "u1" }],
    activities: [{ id: "ac1", subject: "Call", notes: "ok", outcome: "Interested", occurredAt: D, activityType: { name: "Outbound Call" }, ownerUserId: "u1" }],
    interests: [{ id: "i1", label: null, product: { name: "Turf 30mm", totalCostInr: "TOTAL-COST-12345" }, sport: { name: "football" } }],
    deals: [
      {
        id: "d1",
        code: "D-1",
        title: "Hosur turf",
        wonValue: "250000",
        quotedValue: null,
        outcome: "WON",
        closedAt: D,
        expectedStartAt: null,
        executionStatus: "IN_EXECUTION",
        currentStage: { name: "Won" },
      },
    ],
    quotes: [{ id: "q1", number: "FIT-QT-2026-001", sport: "football", grandTotal: "118000.50", status: "sent", createdAt: D, sentAt: D, pdfUrl: "https://blob.example/q.pdf" }],
    designs: [{ id: "cd1", number: "CD-1", status: "sent", createdAt: D, sentAt: null, imageUrl: "https://blob.example/attachment.pdf" }],
  };
  const out = toLeadDetail(source);

  it("returns the useful fields", () => {
    expect(out).toMatchObject({
      id: "c1",
      name: "Asha Rao",
      phone: "+919876543210",
      isLead: true,
      stage: { id: "s1", name: "Quoted" },
      source: "Meta Ads",
      customFields: { plot: "Hosur", budget: "500000" },
      company: { name: "Rao Sports", city: "Hosur", customerProfile: "Academy" },
      rep: { id: "u1", name: "Priya" },
    });
    expect(out.quotes[0]).toEqual({ id: "q1", number: "FIT-QT-2026-001", sport: "football", totalInr: 118000.5, status: "sent", createdAt: D.toISOString(), sentAt: D.toISOString() });
    expect(out.deals[0]).toMatchObject({ valueInr: 250000, stage: "Won", executionStatus: "IN_EXECUTION" });
  });

  it("never carries insights, attachments, storage URLs, cost or credentials", () => {
    expectClean(out);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/insight|attachment|fileUrl|pdfUrl|imageUrl|passwordHash|totalCost|gstin|authorUserId|colorHex/i);
    expect(Object.keys(out).sort()).toEqual(
      [
        "becameLeadAt", "company", "contactNote", "courtDesigns", "createdAt", "customFields", "deals", "designation", "email", "id",
        "isLead", "lastActivityAt", "name", "nextActions", "notes", "phone", "productInterests", "quotes", "recentActivities", "rep",
        "source", "stage", "tasks",
      ].sort(),
    );
  });
});

describe("search_leads row mapper", () => {
  const row = toLeadRow(
    {
      id: "c1",
      name: "Asha Rao",
      phone: "+91 98765 43210",
      pipelineStage: null,
      createdAt: D,
      leadStage: null,
      leadSource: null,
      account: { name: "Rao Sports", city: null, owner: null },
    },
    null,
  );

  it("shows only the last four digits of the phone", () => {
    expect(row.phoneLast4).toBe("3210");
    expect(JSON.stringify(row)).not.toContain("9876");
    expect(phoneLast4(null)).toBeNull();
    expect(phoneLast4("12")).toBeNull();
  });

  it("marks plain contacts as not leads, with nulls where unknown", () => {
    expect(row).toMatchObject({ isLead: false, stage: null, source: null, rep: null, lastActivityAt: null });
  });
});

describe("timeline privacy", () => {
  const e = (over: Partial<TimelineEntry>): TimelineEntry => ({
    id: "x",
    kind: "activity",
    title: "t",
    detail: null,
    timestamp: D.toISOString(),
    ownerName: "Priya",
    ...over,
  });

  it("drops insights, uploaded files and insight/file change events", () => {
    const kept = filterAgentTimeline([
      e({ id: "1", kind: "activity" }),
      e({ id: "2", kind: "insight", title: "Insight added — SECRET-INSIGHT-BODY" }),
      e({ id: "3", kind: "file", title: "File uploaded — id-proof.pdf" }),
      e({ id: "4", kind: "change", label: "INSIGHT", title: "Insight edited" }),
      e({ id: "5", kind: "change", label: "DELETED", title: "File deleted — id-proof.pdf" }),
      e({ id: "6", kind: "change", label: "STAGE", title: "Stage: New to Quoted" }),
      e({ id: "7", kind: "note" }),
      e({ id: "8", kind: "quote" }),
    ]);
    expect(kept.map((x) => x.id)).toEqual(["1", "6", "7", "8"]);
  });

  it("the agent viewer cannot see any rep's private insight events", () => {
    expect(canSeeContactEvent(insightVisibility("some-rep"), AGENT_TIMELINE_VIEWER)).toBe(false);
    expect(canSeeContactEvent(insightVisibility(AGENT_TIMELINE_VIEWER.id + "x"), AGENT_TIMELINE_VIEWER)).toBe(false);
    expect(canSeeContactEvent(null, AGENT_TIMELINE_VIEWER)).toBe(true);
    expect(isAdmin(AGENT_TIMELINE_VIEWER.role) || isManagerOrAbove(AGENT_TIMELINE_VIEWER.role)).toBe(false);
  });

  it("maps owner to a plain 'by' and keeps the label only when present", () => {
    expect(toTimelineItem(e({ label: "STAGE" }))).toEqual({
      id: "x", kind: "activity", title: "t", detail: null, timestamp: D.toISOString(), by: "Priya", label: "STAGE",
    });
    expect("label" in toTimelineItem(e({}))).toBe(false);
  });
});

describe("catalogue mapper", () => {
  const product = {
    id: "p1",
    name: "Turf 30mm",
    type: "flooring",
    description: "Non-infill turf",
    sports: ["football"],
    category: "turf",
    heroImageUrl: "https://public.example/hero.jpg",
    videoUrl: "https://public.example/v.mp4",
    specs: { "Pile height": "30mm" },
    priceInr: 112.5,
    unit: "sq.ft",
    baseWork: "concrete",
    featured: true,
    media: [{ id: "m1", url: "https://public.example/a.jpg", kind: "image", caption: null }],
    tdsFiles: [{ id: "t1", name: "Turf 30mm TDS", url: "https://blob.example/tds.pdf", sport: "football" }],
    createdAt: D.toISOString(),
    totalCostInr: "TOTAL-COST-12345",
  } as unknown as ProductDTO;
  const out = toAgentProduct(product);

  it("returns the catalogue price only as an unconfirmed indicative price", () => {
    expect(out.indicativePrice).toEqual({ amountInr: 112.5, unit: "sq.ft", priceStatus: "indicative_unconfirmed" });
    const keys = JSON.stringify(out);
    expect(keys).not.toMatch(/"priceInr"|"price"|"rate"|"currentRate"/);
  });

  it("has no indicative price when the product has none", () => {
    expect(toAgentProduct({ ...product, priceInr: null }).indicativePrice).toBeNull();
  });

  it("gives TDS titles but not their file URLs, and no cost", () => {
    expect(out.tdsDocuments).toEqual([{ id: "t1", title: "Turf 30mm TDS", sport: "football" }]);
    expectClean(out);
    expect(out.media).toEqual([{ kind: "image", url: "https://public.example/a.jpg", caption: null }]);
  });
});

describe("ad lead mapper", () => {
  const detail = {
    id: "m1",
    fullName: "Ravi",
    phone: "9000000001",
    email: null,
    formName: "Turf form",
    campaignName: "Camp A",
    city: "Pune",
    sport: "cricket",
    area: "5k sq.ft",
    startTime: "Within 3 months",
    stage: "NEW",
    labels: [{ id: "l1", name: "Hot", color: "#f00" }],
    assignedToName: "Priya",
    assignedToUserId: "PRIVATE-AUTHOR-ID",
    inCrm: false,
    capturedAt: D.toISOString(),
    fieldData: JSON.stringify([{ name: "job_title", values: ["Owner"] }]),
    reminderAt: null,
    salesData: JSON.stringify({ sport: "cricket", timeline: "soon" }),
    notes: [{ id: "n1", authorUserId: "PRIVATE-AUTHOR-ID", authorName: "Priya", body: "Call back", createdAt: D.toISOString() }],
    reminders: [{ id: "r1", message: "Call", dueAt: D.toISOString(), status: "PENDING", completedAt: null }],
    rawPayload: "TOKEN-abc123",
  } as unknown as MetaLeadDetail;
  const out = toAgentAdLeadDetail(detail);

  it("parses form answers and sales data, and drops internal ids and raw payloads", () => {
    expect(out.formAnswers).toEqual([{ name: "job_title", value: "Owner" }]);
    expect(out.salesData).toEqual({ sport: "cricket", timeline: "soon" });
    expect(out.labels).toEqual(["Hot"]);
    expect(out.assignedTo).toBe("Priya");
    expectClean(out);
    expect(JSON.stringify(out)).not.toMatch(/authorUserId|assignedToUserId|fieldData|rawPayload|color/);
  });

  it("copes with unparseable sales data", () => {
    expect(toAgentAdLeadDetail({ ...detail, salesData: "{nope" } as MetaLeadDetail).salesData).toBeNull();
    expect(toAgentAdLeadDetail({ ...detail, salesData: null } as MetaLeadDetail).salesData).toBeNull();
  });
});

describe("deal mapper", () => {
  it("names the rep but exposes no owner id, and prefers won value over quoted", () => {
    const source = {
      id: "d1", code: "D-1", title: "Turf", wonValue: null, quotedValue: "90000", closedAt: D, expectedStartAt: null,
      executionStatus: null, ownerUserId: "PRIVATE-AUTHOR-ID", invoices: [{ total: "TOTAL-COST-12345" }],
      account: { name: "Rao Sports", city: "Hosur" },
      primaryContact: { id: "c1", name: "Asha", deletedAt: null },
      owner: { name: " Priya " },
    };
    const row = toDealRow(source);
    expect(row).toMatchObject({ customerName: "Asha", company: "Rao Sports", valueInr: 90000, rep: "Priya" });
    expectClean(row);
  });

  it("falls back to the company when the contact was removed", () => {
    const row = toDealRow({
      id: "d1", code: "D-1", title: "T", wonValue: "1", quotedValue: null, closedAt: null, expectedStartAt: null, executionStatus: null,
      account: { name: "Rao Sports", city: null }, primaryContact: { id: "c1", name: "Asha", deletedAt: D }, owner: null,
    });
    expect(row.customerName).toBe("Rao Sports");
    expect(row.rep).toBeNull();
  });
});

describe("analytics shaping", () => {
  it("removes per-rep and cost keys at any depth", () => {
    const out = stripInternalKeys({
      cities: [
        { city: "Pune", won: 3, reps: [{ ownerId: "u1", ownerName: "Priya", deals: 2 }] },
        { city: "Hosur", won: 1, reps: [] },
      ],
      sources: [{ sourceName: "Meta", leads: 10, adSpend: 5000, costPerLead: 500, cac: 900, roas: 3, nested: { repName: "X", keep: 1 } }],
      repRankings: [{ name: "Priya" }],
      date: new Date("2026-01-01T00:00:00Z"),
    }) as Record<string, any>;
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/reps|ownerId|ownerName|repName|repRankings|adSpend|costPerLead|cac|roas/);
    expect(out.cities.map((c: any) => c.city)).toEqual(["Pune", "Hosur"]);
    expect(out.sources[0]).toMatchObject({ sourceName: "Meta", leads: 10, nested: { keep: 1 } });
    expect(out.date).toBeInstanceOf(Date);
  });

  it("kpi_board keeps headline numbers only: no targets, pace, or rep ranking", () => {
    const out = shapeKpiBoard({
      wonRevenue: 1_000_000,
      winRate: { rate: 0.3, n: 40 },
      avgProjectValue: 250_000,
      salesVelocity: 12_000,
      dealsCreated: 55,
      benchmarks: { trailingWinRate: 0.28, avgCycleDays: 30, avgProjectValue: 240_000 },
      targetProgress: {
        targetRevenue: 9_999_999, targetDeals: 77, wonRevenue: 1_000_000, wonDeals: 4, paceExpected: 1, gapToTarget: 8_999_999,
        openPipelineValue: 300_000, weightedPipelineValue: 120_000,
      },
      repRankings: [{ ownerName: "Priya", wonRevenue: 700_000 }],
      repQuadrantSelf: { x: 1 },
    } as Parameters<typeof shapeKpiBoard>[0]) as Record<string, unknown>;
    expect(out).toEqual({
      wonRevenue: 1_000_000,
      wonDeals: 4,
      winRate: { rate: 0.3, n: 40 },
      avgProjectValue: 250_000,
      salesVelocity: 12_000,
      dealsCreated: 55,
      openPipelineValue: 300_000,
      weightedPipelineValue: 120_000,
      companyBenchmarks: { trailingWinRate: 0.28, avgCycleDays: 30, avgProjectValue: 240_000 },
    });
    expect(JSON.stringify(out)).not.toMatch(/target|pace|gap|rank|Priya|9999999/i);
  });

  it("open deals rows carry no owner, notes, or file links", () => {
    const row = toOpenDealRow({
      dealId: "d1", dealCode: "D-1", dealValue: 100, customerName: "Asha", stageName: "Quoted", interestedProducts: ["Turf"],
      nextActivity: { message: "Call", dueAt: D.toISOString() }, ownerId: "u1", ownerName: "Priya",
      latestNote: { notes: "PRIVATE" }, quotations: [{ id: "q" }], courtImages: [{ imageUrl: "https://blob.example/x" }],
    });
    expect(Object.keys(row).sort()).toEqual(["customerName", "dealCode", "dealId", "interestedProducts", "nextActivity", "stage", "valueInr"]);
  });

  it("the analytics scope is company-wide data access, not the admin role", () => {
    expect(AGENT_ANALYTICS_SCOPE).toEqual({ companyWide: true });
    expect(AGENT_ANALYTICS_SCOPE.ownerIds).toBeUndefined();
    expect(isAdmin("ai_agent")).toBe(false);
  });
});
