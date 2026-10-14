import { z } from "zod/v4";
import { SUPPORTED_SPORTS, type Sport } from "@/lib/quotation/rates";

/**
 * Stage 1 (read-only tools): request and response shapes. The request schemas
 * validate the query string / JSON body inside withAgent; the response schemas
 * type each handler's body and feed the OpenAPI document.
 *
 * Every list is bounded: `limit` (default 20, max 100) plus a `cursor` or `page`.
 */

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 100;
export const MAX_COMPARE_PRODUCTS = 4;
export const MAX_DIMENSION_FT = 2000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isUuid = (v: string): boolean => UUID_RE.test(v);

// ---- query-string building blocks -----------------------------------------

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Optional bounded text; an empty value counts as absent. */
const text = (max = 100) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const uuidParam = z.preprocess(blankToUndefined, z.string().trim().regex(UUID_RE, "must be an id").optional());
const dayParam = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .regex(DAY_RE, "must be YYYY-MM-DD")
    .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), "is not a real date")
    .optional(),
);
const flag = z.preprocess((v) => {
  if (v === undefined || v === "") return undefined;
  if (v === true || v === "true" || v === "1") return true;
  if (v === false || v === "false" || v === "0") return false;
  return v;
}, z.boolean().optional());

export const limitParam = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).default(LIST_DEFAULT_LIMIT),
);
export const cursorParam = text(200);
export const pageParam = z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(10_000).default(1));

export const sportSchema = z.enum(SUPPORTED_SPORTS as [Sport, ...Sport[]]);

const dateRangeRefine = <T extends { from?: string; to?: string }>(v: T) => !v.from || !v.to || v.from <= v.to;
const DATE_RANGE_MSG = { message: "from must not be after to", path: ["from"] };

// ---- shared response pieces -----------------------------------------------

const iso = z.string().describe("ISO 8601 timestamp");
const idName = z.object({ id: z.string(), name: z.string() });
export const nextCursorSchema = z.string().nullable().describe("Pass as `cursor` for the next page; null when there are no more.");

// ---- GET /meta ------------------------------------------------------------

export const crmMetaResponseSchema = z.object({
  leadStages: z.array(z.object({ id: z.string(), name: z.string(), isActive: z.boolean() })),
  leadSources: z.array(idName),
  activityTypes: z.array(idName),
  customerProfiles: z.array(idName),
  supportedSports: z.array(sportSchema),
  productTypes: z.array(z.string()),
  adLeadStages: z.array(z.object({ slug: z.string(), name: z.string() })),
});

// ---- leads ----------------------------------------------------------------

export const searchLeadsQuerySchema = z.object({
  q: text(100),
  phone: text(30),
  stageId: uuidParam,
  ownerId: uuidParam,
  source: text(60),
  includeContacts: flag,
  limit: limitParam,
  cursor: cursorParam,
});
export type SearchLeadsInput = z.infer<typeof searchLeadsQuerySchema>;

export const leadRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string(),
  city: z.string().nullable(),
  phoneLast4: z.string().nullable(),
  isLead: z.boolean().describe("true = in the Leads funnel; false = a plain customer contact"),
  stage: idName.nullable(),
  source: z.string().nullable(),
  rep: idName.nullable().describe("The sales rep handling this customer"),
  lastActivityAt: iso.nullable(),
  createdAt: iso,
});
export type LeadRow = z.infer<typeof leadRowSchema>;

export const searchLeadsResponseSchema = z.object({
  items: z.array(leadRowSchema),
  nextCursor: nextCursorSchema,
});

export const leadDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  designation: z.string().nullable(),
  contactNote: z.string().nullable(),
  isLead: z.boolean(),
  stage: idName.nullable(),
  source: z.string().nullable(),
  customFields: z.record(z.string(), z.string()),
  company: z.object({
    id: z.string(),
    name: z.string(),
    city: z.string().nullable(),
    businessType: z.string().nullable(),
    customerProfile: z.string().nullable(),
  }),
  rep: idName.nullable(),
  createdAt: iso,
  becameLeadAt: iso.nullable(),
  lastActivityAt: iso.nullable(),
  notes: z.array(z.object({ id: z.string(), title: z.string().nullable(), body: z.string(), createdAt: iso, author: z.string() })),
  nextActions: z.array(z.object({ id: z.string(), text: z.string(), dueAt: iso.nullable() })),
  tasks: z.array(z.object({ id: z.string(), message: z.string(), dueAt: iso, priority: z.string().nullable() })),
  recentActivities: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      subject: z.string(),
      notes: z.string().nullable(),
      outcome: z.string().nullable(),
      occurredAt: iso,
    }),
  ),
  productInterests: z.array(z.object({ id: z.string(), name: z.string(), sport: z.string().nullable() })),
  deals: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      title: z.string(),
      valueInr: z.number().nullable(),
      outcome: z.string().nullable(),
      stage: z.string(),
      wonAt: iso.nullable(),
      expectedStartAt: iso.nullable(),
      executionStatus: z.string().nullable(),
    }),
  ),
  quotes: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      sport: z.string(),
      totalInr: z.number(),
      status: z.string(),
      createdAt: iso,
      sentAt: iso.nullable(),
    }),
  ),
  courtDesigns: z.array(z.object({ id: z.string(), number: z.string(), status: z.string(), createdAt: iso, sentAt: iso.nullable() })),
});

export const leadTimelineQuerySchema = z.object({ limit: limitParam, cursor: cursorParam });

export const timelineItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  timestamp: iso,
  by: z.string().nullable(),
  label: z.string().optional(),
});
export const leadTimelineResponseSchema = z.object({
  items: z.array(timelineItemSchema),
  nextCursor: nextCursorSchema,
});

export const duplicateCheckBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(1).max(30).optional(),
    company: z.string().trim().min(1).max(160).optional(),
    city: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => !!(v.name || v.phone || v.company), { message: "Give at least one of name, phone or company." });
export type DuplicateCheckInput = z.infer<typeof duplicateCheckBodySchema>;

export const duplicateMatchSchema = z.object({
  type: z.enum(["crm_lead", "crm_contact", "company", "whatsapp_contact", "ad_lead"]),
  id: z.string(),
  name: z.string().nullable(),
  company: z.string().nullable(),
  phoneLast4: z.string().nullable(),
  matchedOn: z.enum(["phone", "name_in_company", "company_name", "name_only"]),
  confidence: z.enum(["high", "low"]),
  detail: z.string().nullable().describe("Stage / campaign, to help tell records apart"),
});
export type DuplicateMatch = z.infer<typeof duplicateMatchSchema>;
export const duplicateCheckResponseSchema = z.object({
  hasDuplicates: z.boolean(),
  matches: z.array(duplicateMatchSchema),
});

// ---- ad (Meta) leads ------------------------------------------------------

export const adLeadsQuerySchema = z
  .object({
    from: dayParam,
    to: dayParam,
    campaign: text(100),
    city: text(100),
    sport: text(100),
    area: text(100),
    start: text(100),
    stage: text(60),
    assigned: text(100),
    label: text(100),
    limit: limitParam,
    page: pageParam,
  })
  .refine(dateRangeRefine, DATE_RANGE_MSG);
export type AdLeadsInput = z.infer<typeof adLeadsQuerySchema>;

export const adLeadRowSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  formName: z.string().nullable(),
  campaignName: z.string().nullable(),
  city: z.string().nullable(),
  sport: z.string().nullable(),
  area: z.string().nullable(),
  startTime: z.string().nullable(),
  stage: z.string(),
  labels: z.array(z.string()),
  assignedTo: z.string().nullable(),
  inCrm: z.boolean(),
  capturedAt: iso,
});
export type AdLeadRow = z.infer<typeof adLeadRowSchema>;
export const adLeadsResponseSchema = z.object({
  items: z.array(adLeadRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageCount: z.number().int(),
  limit: z.number().int(),
});
export const adLeadDetailSchema = adLeadRowSchema.extend({
  formAnswers: z.array(z.object({ name: z.string(), value: z.string() })),
  salesData: z.record(z.string(), z.unknown()).nullable(),
  notes: z.array(z.object({ id: z.string(), body: z.string(), author: z.string(), createdAt: iso })),
  reminders: z.array(z.object({ id: z.string(), message: z.string(), dueAt: iso, status: z.string(), completedAt: iso.nullable() })),
});

export const adLeadAnalyticsQuerySchema = z
  .object({ from: dayParam, to: dayParam })
  .refine(dateRangeRefine, DATE_RANGE_MSG);
export const adLeadAnalyticsResponseSchema = z.object({
  from: iso,
  to: iso,
  analytics: z.record(z.string(), z.unknown()).describe("Lead counts by city, sport, area, job, campaign and repeat submitters."),
});

// ---- catalogue ------------------------------------------------------------

export const PRICE_STATUS = "indicative_unconfirmed" as const;

export const catalogueSearchQuerySchema = z.object({
  q: text(100),
  sport: text(40),
  type: z.preprocess(blankToUndefined, z.enum(["flooring", "material", "equipment"]).optional()),
  limit: limitParam,
  cursor: cursorParam,
});
export type CatalogueSearchInput = z.infer<typeof catalogueSearchQuerySchema>;

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  category: z.string().nullable(),
  description: z.string(),
  sports: z.array(z.string()),
  specs: z.record(z.string(), z.string()),
  featured: z.boolean(),
  indicativePrice: z
    .object({
      amountInr: z.number(),
      unit: z.string().nullable(),
      priceStatus: z.literal(PRICE_STATUS),
    })
    .nullable()
    .describe("NOT a quoted price. Never present it to a customer as the price; the Fitoverse team confirms pricing."),
  heroImageUrl: z.string().nullable(),
  media: z.array(z.object({ kind: z.string(), url: z.string(), caption: z.string().nullable() })),
  tdsDocuments: z.array(z.object({ id: z.string(), title: z.string(), sport: z.string() })),
});
export type AgentProduct = z.infer<typeof productSchema>;
export const catalogueSearchResponseSchema = z.object({ items: z.array(productSchema), nextCursor: nextCursorSchema });

export const compareBodySchema = z.object({
  productIds: z
    .array(z.string().trim().regex(UUID_RE, "must be a product id"))
    .min(2, "Give at least 2 products to compare.")
    .max(MAX_COMPARE_PRODUCTS, `Compare at most ${MAX_COMPARE_PRODUCTS} products at a time.`),
});
export const compareResponseSchema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      category: z.string().nullable(),
      sports: z.array(z.string()),
      indicativePrice: productSchema.shape.indicativePrice,
    }),
  ),
  specs: z.array(
    z.object({
      spec: z.string(),
      values: z.record(z.string(), z.string().nullable()).describe("productId -> value (null when the product does not list it)"),
      differs: z.boolean(),
    }),
  ),
  differingSpecs: z.array(z.string()),
  commonSpecs: z.array(z.string()),
});
export const availabilityResponseSchema = z.object({
  productId: z.string(),
  status: z.literal("unknown"),
  message: z.string(),
});

// ---- pricing --------------------------------------------------------------

export const rateSheetQuerySchema = z.object({ sport: sportSchema });
export const rateSheetResponseSchema = z.object({
  sport: sportSchema,
  currency: z.literal("INR"),
  source: z.enum(["admin_rate_sheet", "built_in_defaults"]),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      section: z.string().nullable(),
      areaMode: z.enum(["plot", "wrap", "per_piece", "perimeter"]),
      unit: z.string(),
      ratePerUnit: z.number(),
      gstPercent: z.number(),
      optional: z.boolean(),
    }),
  ),
});

export const estimateBodySchema = z.object({
  sport: sportSchema,
  lengthFt: z.number().positive().max(MAX_DIMENSION_FT),
  widthFt: z.number().positive().max(MAX_DIMENSION_FT),
  items: z
    .array(
      z.object({
        rateItemId: z.string().trim().min(1).max(80),
        quantity: z.number().min(0).max(100_000).optional().describe("Per-piece items only."),
        included: z.boolean().optional().describe("false removes a default item; true adds an optional one. Default true."),
      }),
    )
    .max(60)
    .optional(),
});
export type EstimateInput = z.infer<typeof estimateBodySchema>;

export const estimateLineSchema = z.object({
  rateItemId: z.string(),
  name: z.string(),
  unit: z.string(),
  quantity: z.number().describe("Area in sq.ft, running ft, or number of pieces, depending on the unit"),
  ratePerUnit: z.number(),
  gstPercent: z.number(),
  amount: z.number().describe("Before GST"),
  gstAmount: z.number(),
});
export const estimateResponseSchema = z.object({
  kind: z.literal("estimate"),
  sport: sportSchema,
  lengthFt: z.number(),
  widthFt: z.number(),
  plotAreaSqFt: z.number(),
  currency: z.literal("INR"),
  lines: z.array(estimateLineSchema),
  optionalItems: z.array(z.object({ rateItemId: z.string(), name: z.string(), areaMode: z.string() })),
  subtotal: z.number(),
  gst: z.number(),
  total: z.number(),
  priceSource: z.enum(["admin_rate_sheet", "built_in_defaults"]),
  warnings: z.array(z.string()),
  disclaimer: z.string(),
});
export type EstimateResponse = z.infer<typeof estimateResponseSchema>;

// ---- deals ----------------------------------------------------------------

export const dealsQuerySchema = z
  .object({ q: text(100), from: dayParam, to: dayParam, limit: limitParam, cursor: cursorParam })
  .refine(dateRangeRefine, DATE_RANGE_MSG);
export type DealsInput = z.infer<typeof dealsQuerySchema>;

export const dealRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  customerName: z.string(),
  company: z.string(),
  city: z.string().nullable(),
  valueInr: z.number().nullable(),
  wonAt: iso.nullable(),
  expectedStartAt: iso.nullable(),
  executionStatus: z.string().nullable(),
  rep: z.string().nullable(),
});
export type DealRow = z.infer<typeof dealRowSchema>;
export const dealsResponseSchema = z.object({ items: z.array(dealRowSchema), nextCursor: nextCursorSchema });
export const dealDetailSchema = dealRowSchema.extend({
  customerId: z.string().nullable(),
  note: z.string().nullable(),
  siteCity: z.string().nullable(),
  siteState: z.string().nullable(),
  stage: z.string(),
  stageHistory: z.array(z.object({ from: z.string().nullable(), to: z.string(), at: iso })),
  lineItems: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      sport: z.string().nullable(),
      quantity: z.number(),
      unit: z.string().nullable(),
      rateInr: z.number().nullable(),
      amountInr: z.number().nullable(),
      enquiryOnly: z.boolean(),
    }),
  ),
  quotes: z.array(
    z.object({ id: z.string(), number: z.string(), totalInr: z.number(), status: z.string(), sentAt: iso.nullable() }),
  ),
});

// ---- pipeline -------------------------------------------------------------

export const pipelineQuerySchema = z.object({
  stageId: z.preprocess(
    blankToUndefined,
    z.union([z.literal("unstaged"), z.string().trim().regex(UUID_RE, "must be a stage id or 'unstaged'")]).optional(),
  ),
  limit: limitParam,
  cursor: cursorParam,
});
export const pipelineResponseSchema = z.object({
  stages: z.array(z.object({ id: z.string(), name: z.string(), isActive: z.boolean(), count: z.number().int() })),
  unstagedCount: z.number().int(),
  totalLeads: z.number().int(),
  leads: z.array(leadRowSchema),
  nextCursor: nextCursorSchema,
});

// ---- analytics ------------------------------------------------------------

export const ANALYTICS_REPORTS = ["kpi_board", "funnel", "products", "geography", "sources", "seasonality", "open_deals"] as const;
export type AnalyticsReport = (typeof ANALYTICS_REPORTS)[number];
export const ANALYTICS_PERIODS = ["this_week", "last_week", "this_month", "last_month", "this_quarter", "this_fy", "all_time"] as const;

export const analyticsQuerySchema = z
  .object({
    period: z.preprocess(blankToUndefined, z.enum(ANALYTICS_PERIODS).optional()),
    from: dayParam,
    to: dayParam,
    limit: limitParam,
    page: pageParam,
  })
  .refine((v) => !!v.from === !!v.to, { message: "Give both from and to, or neither.", path: ["from"] })
  .refine(dateRangeRefine, DATE_RANGE_MSG);
export type AnalyticsInput = z.infer<typeof analyticsQuerySchema>;

export const analyticsResponseSchema = z.object({
  report: z.enum(ANALYTICS_REPORTS),
  period: z.union([z.enum(ANALYTICS_PERIODS), z.object({ from: z.string(), to: z.string() })]),
  data: z.unknown().describe("Company-wide aggregates. No per-rep figures."),
  page: z
    .object({ page: z.number().int(), limit: z.number().int(), total: z.number().int(), hasMore: z.boolean() })
    .optional()
    .describe("Only for open_deals, the one report that is a list."),
});
