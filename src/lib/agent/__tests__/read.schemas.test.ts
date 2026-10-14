import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildOpenApi } from "../openapi";
import { TOOL_REGISTRY, effectiveVerdict } from "../permissions";
import { ROUTES, TOOLS } from "../registry/read";
import {
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  adLeadAnalyticsQuerySchema,
  adLeadsQuerySchema,
  analyticsQuerySchema,
  catalogueSearchQuerySchema,
  compareBodySchema,
  dealsQuerySchema,
  duplicateCheckBodySchema,
  estimateBodySchema,
  leadTimelineQuerySchema,
  pipelineQuerySchema,
  rateSheetQuerySchema,
  searchLeadsQuerySchema,
} from "../schemas/read";

const UUID = "3f2b8c1e-9d4a-4b6f-8a1c-5e7d9b0a2c4f";
const UUID2 = "7a1d2c3b-4e5f-4a6b-9c8d-0e1f2a3b4c5d";

describe("pagination bounds", () => {
  const listSchemas = {
    searchLeads: searchLeadsQuerySchema,
    timeline: leadTimelineQuerySchema,
    adLeads: adLeadsQuerySchema,
    catalogue: catalogueSearchQuerySchema,
    deals: dealsQuerySchema,
    pipeline: pipelineQuerySchema,
  };

  it("defaults to 20 and caps at 100 on every list", () => {
    expect(LIST_DEFAULT_LIMIT).toBe(20);
    expect(LIST_MAX_LIMIT).toBe(100);
    for (const [name, schema] of Object.entries(listSchemas)) {
      expect((schema.parse({}) as { limit: number }).limit, name).toBe(20);
      expect((schema.parse({ limit: "100" }) as { limit: number }).limit, name).toBe(100);
      expect(schema.safeParse({ limit: "101" }).success, name).toBe(false);
      expect(schema.safeParse({ limit: "0" }).success, name).toBe(false);
      expect(schema.safeParse({ limit: "-5" }).success, name).toBe(false);
      expect(schema.safeParse({ limit: "2.5" }).success, name).toBe(false);
      expect(schema.safeParse({ limit: "abc" }).success, name).toBe(false);
    }
  });

  it("treats an empty limit or cursor as absent", () => {
    const parsed = searchLeadsQuerySchema.parse({ limit: "", cursor: "", q: "  " });
    expect(parsed.limit).toBe(20);
    expect(parsed.cursor).toBeUndefined();
    expect(parsed.q).toBeUndefined();
  });

  it("pages ad leads and open deals by page number, within bounds", () => {
    expect(adLeadsQuerySchema.parse({}).page).toBe(1);
    expect(adLeadsQuerySchema.parse({ page: "3" }).page).toBe(3);
    expect(adLeadsQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(adLeadsQuerySchema.safeParse({ page: "10001" }).success).toBe(false);
    expect(analyticsQuerySchema.parse({}).limit).toBe(20);
    expect(analyticsQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("bounds the search text", () => {
    expect(searchLeadsQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    expect(searchLeadsQuerySchema.safeParse({ phone: "9".repeat(31) }).success).toBe(false);
    expect(catalogueSearchQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
  });
});

describe("search_leads query", () => {
  it("accepts the documented filters", () => {
    const v = searchLeadsQuerySchema.parse({
      q: " Rao ",
      phone: "98765 43210",
      stageId: UUID,
      ownerId: UUID2,
      source: "Meta Ads",
      includeContacts: "true",
    });
    expect(v).toMatchObject({ q: "Rao", phone: "98765 43210", stageId: UUID, ownerId: UUID2, includeContacts: true });
  });

  it("parses the includeContacts flag strictly", () => {
    expect(searchLeadsQuerySchema.parse({ includeContacts: "1" }).includeContacts).toBe(true);
    expect(searchLeadsQuerySchema.parse({ includeContacts: "false" }).includeContacts).toBe(false);
    expect(searchLeadsQuerySchema.parse({}).includeContacts).toBeUndefined();
    expect(searchLeadsQuerySchema.safeParse({ includeContacts: "maybe" }).success).toBe(false);
  });

  it("rejects ids that are not ids", () => {
    expect(searchLeadsQuerySchema.safeParse({ stageId: "1; DROP TABLE" }).success).toBe(false);
    expect(searchLeadsQuerySchema.safeParse({ ownerId: "abc" }).success).toBe(false);
  });
});

describe("sport validation", () => {
  it("accepts every supported sport and nothing else", () => {
    for (const sport of ["football", "basketball", "multisport", "pickleball", "tennis", "volleyball", "cricket", "badminton"]) {
      expect(rateSheetQuerySchema.safeParse({ sport }).success, sport).toBe(true);
    }
    for (const sport of ["golf", "Football", "", "football ", undefined]) {
      expect(rateSheetQuerySchema.safeParse({ sport }).success, String(sport)).toBe(false);
    }
  });

  it("applies the same rule to estimate_price", () => {
    const base = { lengthFt: 100, widthFt: 60 };
    expect(estimateBodySchema.safeParse({ ...base, sport: "tennis" }).success).toBe(true);
    expect(estimateBodySchema.safeParse({ ...base, sport: "rugby" }).success).toBe(false);
    expect(estimateBodySchema.safeParse(base).success).toBe(false);
  });
});

describe("estimate_price body", () => {
  const ok = { sport: "football", lengthFt: 100, widthFt: 60 };

  it("rejects bad dimensions", () => {
    for (const bad of [0, -1, Number.NaN, 2001, "100"]) {
      expect(estimateBodySchema.safeParse({ ...ok, lengthFt: bad }).success, String(bad)).toBe(false);
      expect(estimateBodySchema.safeParse({ ...ok, widthFt: bad }).success, String(bad)).toBe(false);
    }
    expect(estimateBodySchema.safeParse({ ...ok, lengthFt: 2000, widthFt: 0.5 }).success).toBe(true);
  });

  it("has no field through which a rate could be passed", () => {
    const parsed = estimateBodySchema.parse({
      ...ok,
      rate: 1,
      ratePerSqFt: 1,
      items: [{ rateItemId: "turf", quantity: 2, included: true, defaultRate: 1, rate: 1 }],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/rate"|ratePerSqFt|defaultRate/);
    expect(Object.keys(parsed.items![0]).sort()).toEqual(["included", "quantity", "rateItemId"]);
  });

  it("bounds the item list and quantities", () => {
    expect(estimateBodySchema.safeParse({ ...ok, items: [{ rateItemId: "x", quantity: -1 }] }).success).toBe(false);
    expect(estimateBodySchema.safeParse({ ...ok, items: [{ rateItemId: "x", quantity: 100_001 }] }).success).toBe(false);
    expect(
      estimateBodySchema.safeParse({ ...ok, items: Array.from({ length: 61 }, (_, i) => ({ rateItemId: `i${i}` })) }).success,
    ).toBe(false);
  });
});

describe("compare_products body", () => {
  it("needs 2 to 4 product ids", () => {
    expect(compareBodySchema.safeParse({ productIds: [UUID] }).success).toBe(false);
    expect(compareBodySchema.safeParse({ productIds: [UUID, UUID2] }).success).toBe(true);
    const five = Array.from({ length: 5 }, (_, i) => UUID.replace(/.$/, String(i)));
    expect(compareBodySchema.safeParse({ productIds: five.slice(0, 4) }).success).toBe(true);
    expect(compareBodySchema.safeParse({ productIds: five }).success).toBe(false);
    expect(compareBodySchema.safeParse({ productIds: [UUID, "nope"] }).success).toBe(false);
  });
});

describe("check_duplicates body", () => {
  it("needs at least one of name, phone or company", () => {
    expect(duplicateCheckBodySchema.safeParse({}).success).toBe(false);
    expect(duplicateCheckBodySchema.safeParse({ city: "Pune" }).success).toBe(false);
    expect(duplicateCheckBodySchema.safeParse({ phone: "9876543210" }).success).toBe(true);
    expect(duplicateCheckBodySchema.safeParse({ name: "A", company: "B" }).success).toBe(true);
  });
});

describe("date windows", () => {
  it("accepts real YYYY-MM-DD days and rejects the rest", () => {
    expect(adLeadAnalyticsQuerySchema.safeParse({ from: "2026-01-01", to: "2026-03-31" }).success).toBe(true);
    expect(adLeadAnalyticsQuerySchema.safeParse({ from: "01/01/2026" }).success).toBe(false);
    expect(adLeadAnalyticsQuerySchema.safeParse({ from: "2026-13-45" }).success).toBe(false);
    expect(adLeadAnalyticsQuerySchema.safeParse({ from: "2026-04-01", to: "2026-03-01" }).success).toBe(false);
  });

  it("analytics wants both ends of a custom range, or a named period", () => {
    expect(analyticsQuerySchema.safeParse({ from: "2026-01-01" }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ from: "2026-01-01", to: "2026-02-01" }).success).toBe(true);
    expect(analyticsQuerySchema.safeParse({ period: "this_fy" }).success).toBe(true);
    expect(analyticsQuerySchema.safeParse({ period: "forever" }).success).toBe(false);
  });
});

describe("registry", () => {
  const names = Object.keys(TOOLS);

  it("registers the 18 stage-1 tools, all ALLOWED reads", () => {
    expect(names.sort()).toEqual(
      [
        "check_availability",
        "check_duplicates",
        "compare_products",
        "estimate_price",
        "get_ad_lead",
        "get_ad_lead_analytics",
        "get_analytics",
        "get_crm_meta",
        "get_deal",
        "get_lead",
        "get_lead_timeline",
        "get_pipeline",
        "get_product",
        "get_rate_sheet",
        "list_ad_leads",
        "list_deals",
        "search_catalogue",
        "search_leads",
      ].sort(),
    );
    for (const n of names) {
      expect(TOOLS[n], n).toEqual({ default: "ALLOWED", action: "read" });
      expect(TOOL_REGISTRY[n], n).toBeDefined();
      expect(effectiveVerdict(n), n).toBe("ALLOWED");
    }
  });

  it("gives each tool its own definition object", () => {
    expect(TOOLS.get_lead).not.toBe(TOOLS.search_leads);
  });

  it("has exactly one route per tool, each with a response schema", () => {
    expect(ROUTES.map((r) => r.tool).sort()).toEqual(names.sort());
    for (const r of ROUTES) {
      expect(r.responseSchema, r.path).toBeDefined();
      expect(r.summary.length, r.path).toBeGreaterThan(20);
    }
    // No two routes share a method + path.
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives POST routes a request schema and GET routes none (GET inputs are query strings)", () => {
    for (const r of ROUTES) {
      if (r.method === "post") expect(r.requestSchema, r.path).toBeDefined();
      else expect(r.requestSchema, r.path).toBeUndefined();
    }
  });

  it("appears in the OpenAPI document as authenticated reads with no Idempotency-Key", () => {
    const doc = buildOpenApi() as { paths: Record<string, Record<string, any>> };
    for (const r of ROUTES) {
      const op = doc.paths[r.path]?.[r.method];
      expect(op, `${r.method} ${r.path}`).toBeDefined();
      expect(op["x-tool"]).toBe(r.tool);
      expect(op["x-default-verdict"]).toBe("ALLOWED");
      expect(op.security).toEqual([{ bearerAuth: [] }]);
      expect(op.parameters.some((p: { name: string }) => p.name === "Idempotency-Key")).toBe(false);
      expect(op.responses["200"].content["application/json"].schema).toBeDefined();
      expect(op.responses["202"]).toBeUndefined();
      if (r.method === "post") expect(op.requestBody.content["application/json"].schema.type).toBe("object");
    }
  });
});
