// Receiving a "Build a court" lead from the Fitoverse website: check the secret,
// validate the payload, keep only LIVE-site leads, save once per website lead id,
// and tell the admins and managers.
//
// The website (fitoverse-website-main src/app/api/lead/route.ts) POSTs this JSON
// when a visitor submits the form: { id, receivedAt, name, phone, email, city,
// state, job_title, sport, area_sqft, length_ft, width_ft, start_when, notes,
// answers: [{ key, label, value }], surface, env, source, userAgent,
// attribution? }. `attribution` (where the visit came from) is optional and only
// ever trimmed, never a reason to refuse a lead: see sanitizeAttribution.
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { sendPushToUser } from "@/lib/push";
import { after } from "@/lib/scout/after";
import { CLICK_IDS, classify, parseReferrer, type ClickId } from "@/lib/website-analytics/sources";
import { WEBSITE_LEAD_KEY_SETTING, keyMatchesHash } from "./key";

// ---------------------------------------------------------------------------
// Secret
// ---------------------------------------------------------------------------

/** Is `key` (the ?key= of the webhook URL) the one issued with scripts/website-lead-key.ts? */
export async function isValidIncomingKey(key: string | null | undefined): Promise<boolean> {
  if (!key) return false;
  const row = await prisma.setting.findUnique({ where: { key: WEBSITE_LEAD_KEY_SETTING }, select: { value: true } });
  return keyMatchesHash(key, row?.value);
}

// ---------------------------------------------------------------------------
// Live-site filter
// ---------------------------------------------------------------------------

// The website stamps every lead with source "fitoverse.com/build" (a constant in its
// src/app/api/lead/route.ts). Its `env` field is NOT a deployment marker: it is the
// court configurator's facility type (school, academy, apartment, commercial, home,
// corporate). So the live check is: the source is the live site, no field says
// test/preview, and, if the website ever adds a `deployment` field (e.g. VERCEL_ENV),
// it must be "production".
export const LIVE_LEAD_SOURCE = "fitoverse.com/build";
const NOT_LIVE_MARKER = /^(test|testing|preview|dev|development|staging|stage|local|localhost|sandbox)\b/i;

export function isLiveWebsiteLead(p: {
  source?: string | null;
  env?: string | null;
  deployment?: string | null;
}): boolean {
  const source = (p.source ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (source !== LIVE_LEAD_SOURCE) return false;
  if (p.env && NOT_LIVE_MARKER.test(p.env.trim())) return false;
  if (p.deployment && p.deployment.trim().toLowerCase() !== "production") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Optional text is trimmed and cut to a generous cap instead of rejecting the lead:
// a long note must never cost us the enquiry.
const textOf = (max: number) => (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return null;
  return v.trim().slice(0, max) || null;
};

const intOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 100_000_000 ? Math.round(n) : null;
};

const dateOf = (v: unknown): Date => {
  const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
  const now = Date.now();
  // Anything unreadable, before 2020 or more than a day ahead is the clock's fault: use now.
  return d && d.getTime() > Date.UTC(2020, 0, 1) && d.getTime() < now + 86_400_000 ? d : new Date(now);
};

export type WebsiteLeadAnswer = { key: string; label: string; value: string };

const MAX_ANSWERS = 100;
function answersOf(v: unknown): WebsiteLeadAnswer[] {
  const out: WebsiteLeadAnswer[] = [];
  if (Array.isArray(v)) {
    for (const item of v.slice(0, MAX_ANSWERS)) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const key = textOf(200)(o.key) ?? "";
      const value = textOf(5000)(o.value);
      if (value) out.push({ key, label: textOf(300)(o.label) ?? key, value });
    }
  } else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, MAX_ANSWERS)) {
      const value = textOf(5000)(val);
      if (value) out.push({ key: k.slice(0, 200), label: k.slice(0, 300), value });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Attribution: where the visitor came from (sent by newer versions of the website)
// ---------------------------------------------------------------------------

export type WebsiteLeadAttribution = {
  referrer: string | null; // full URL of the other site the visit started from
  landing_page: string | null; // path of the first page, no query string
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  click_id: ClickId | null; // WHICH ad click id was present, never its value
  first_seen_at: string | null; // ISO time of the first page view
};

const ATTRIBUTION_KEYS = [
  "referrer", "landing_page", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "click_id",
  "first_seen_at",
] as const;

const pathOf = (v: unknown): string | null => {
  const raw = textOf(1000)(v);
  if (!raw) return null;
  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      path = new URL(raw).pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/)[0];
  return path.startsWith("/") ? path.slice(0, 300) : null;
};

const isoOf = (v: unknown): string | null => {
  const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
  return d && d.getTime() > Date.UTC(2020, 0, 1) && d.getTime() < Date.now() + 86_400_000 ? d.toISOString() : null;
};

// Origin + path only: a referrer's query string or #fragment can carry personal data.
function referrerOriginPath(raw: string | null): string | null {
  if (!raw || !parseReferrer(raw)) return null;
  try {
    const u = new URL(raw);
    return (u.origin + u.pathname).slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * The website's `attribution` object cleaned up for storing: right types, cut
 * lengths, only a known click id, the referrer only if it is an http(s) URL.
 * A bad part is dropped (null); a body that isn't an attribution object at all
 * (an old website sends none) gives null, and the lead is saved as "Unknown".
 */
export function sanitizeAttribution(v: unknown): WebsiteLeadAttribution | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!ATTRIBUTION_KEYS.some((k) => k in o)) return null;
  const clickId = typeof o.click_id === "string" ? o.click_id.trim().toLowerCase() : "";
  return {
    referrer: referrerOriginPath(typeof o.referrer === "string" ? o.referrer : null),
    landing_page: pathOf(o.landing_page),
    utm_source: textOf(150)(o.utm_source),
    utm_medium: textOf(150)(o.utm_medium),
    utm_campaign: textOf(150)(o.utm_campaign),
    utm_term: textOf(150)(o.utm_term),
    utm_content: textOf(150)(o.utm_content),
    click_id: (CLICK_IDS as readonly string[]).includes(clickId) ? (clickId as ClickId) : null,
    first_seen_at: isoOf(o.first_seen_at),
  };
}

/** The four columns a lead stores for its attribution; all null when the website sent none. */
export function attributionColumns(a: WebsiteLeadAttribution | null): {
  cameFrom: string | null;
  cameFromGroup: string | null;
  landingPage: string | null;
  attribution: string | null;
} {
  if (!a) return { cameFrom: null, cameFromGroup: null, landingPage: null, attribution: null };
  const ref = parseReferrer(a.referrer);
  const { label, group } = classify({
    referrerHost: ref?.host,
    referrerPath: ref?.path,
    utmSource: a.utm_source,
    utmMedium: a.utm_medium,
    clickId: a.click_id,
  });
  return { cameFrom: label, cameFromGroup: group, landingPage: a.landing_page, attribution: JSON.stringify(a) };
}

const payloadSchema = z.object({
  id: z.string().trim().min(1).max(100),
  receivedAt: z.unknown().transform(dateOf),
  name: z.string().trim().min(1).max(300),
  phone: z.string().trim().min(1).max(40),
  email: z.unknown().transform(textOf(320)),
  city: z.unknown().transform(textOf(200)),
  state: z.unknown().transform(textOf(100)),
  job_title: z.unknown().transform(textOf(200)),
  sport: z.unknown().transform(textOf(100)),
  area_sqft: z.unknown().transform(intOf),
  length_ft: z.unknown().transform(intOf),
  width_ft: z.unknown().transform(intOf),
  start_when: z.unknown().transform(textOf(200)),
  notes: z.unknown().transform(textOf(5000)),
  answers: z.unknown().transform(answersOf),
  surface: z.unknown().transform(textOf(100)),
  env: z.unknown().transform(textOf(100)),
  source: z.unknown().transform(textOf(200)),
  userAgent: z.unknown().transform(textOf(500)),
  deployment: z.unknown().transform(textOf(50)),
  attribution: z.unknown().transform(sanitizeAttribution),
});

export type WebsiteLeadPayload = z.infer<typeof payloadSchema>;

export function parseWebsiteLeadPayload(
  body: unknown,
): { ok: true; lead: WebsiteLeadPayload } | { ok: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const parsed = payloadSchema.safeParse(body);
  return parsed.success ? { ok: true, lead: parsed.data } : { ok: false };
}

// ---------------------------------------------------------------------------
// Save + notify
// ---------------------------------------------------------------------------

export type IngestResult =
  | { kind: "created"; id: string }
  | { kind: "duplicate" } // this website lead id is already saved
  | { kind: "ignored" } // not from the live site
  | { kind: "invalid" };

// A new lead starts at the first active stage of the shared lead pipeline.
async function firstStageSlug(): Promise<string> {
  const stage = await prisma.metaLeadStage
    .findFirst({ where: { deletedAt: null, isActive: true }, orderBy: { sortOrder: "asc" }, select: { slug: true } })
    .catch(() => null);
  return stage?.slug ?? "NEW";
}

export async function ingestWebsiteLead(body: unknown): Promise<IngestResult> {
  const parsed = parseWebsiteLeadPayload(body);
  if (!parsed.ok) return { kind: "invalid" };
  const lead = parsed.lead;

  if (!isLiveWebsiteLead(lead)) {
    // No personal data in the log: just why it was skipped.
    console.warn(`[website-leads] ignored a lead that is not from the live site (source=${lead.source ?? "none"})`);
    return { kind: "ignored" };
  }

  const stage = await firstStageSlug();
  let saved: { id: string; name: string; city: string | null; sport: string | null };
  try {
    saved = await prisma.websiteLead.create({
      data: {
        websiteLeadId: lead.id,
        receivedAt: lead.receivedAt,
        name: lead.name,
        phone: lead.phone,
        normalizedPhone: normalizePhone(lead.phone),
        email: lead.email,
        city: lead.city,
        state: lead.state,
        jobTitle: lead.job_title,
        sport: lead.sport,
        areaSqft: lead.area_sqft,
        lengthFt: lead.length_ft,
        widthFt: lead.width_ft,
        startWhen: lead.start_when,
        notes: lead.notes,
        answers: lead.answers,
        surface: lead.surface,
        env: lead.env,
        source: lead.source,
        userAgent: lead.userAgent,
        ...attributionColumns(lead.attribution),
        stage,
      },
      select: { id: true, name: true, city: true, sport: true },
    });
  } catch (err) {
    // The same website lead id again (a retry): one row only, and still a success.
    if ((err as { code?: string }).code === "P2002") return { kind: "duplicate" };
    throw err;
  }

  after(() => notifyNewWebsiteLead(saved));
  return { kind: "created", id: saved.id };
}

/** "Asha Rao · Pune · Football" (missing parts left out). */
export function websiteLeadPushBody(l: { name: string; city: string | null; sport: string | null }): string {
  return [l.name, l.city, l.sport].filter((x): x is string => !!x && !!x.trim()).join(" · ");
}

// Best effort: push to every active, approved admin and manager who has push on.
// Nothing here may fail the webhook, which has already answered.
export async function notifyNewWebsiteLead(l: {
  id: string;
  name: string;
  city: string | null;
  sport: string | null;
}): Promise<void> {
  try {
    const people = await prisma.user.findMany({
      where: {
        role: { in: ["admin", "manager"] },
        isActive: true,
        deletedAt: null,
        approvalStatus: "approved",
        pushEnabled: true,
      },
      select: { id: true },
    });
    const payload = {
      title: "New website lead",
      body: websiteLeadPushBody(l),
      url: `/website-leads/${l.id}`,
      tag: `website-lead-${l.id}`,
    };
    await Promise.allSettled(people.map((p) => sendPushToUser(p.id, payload)));
  } catch (err) {
    console.error("[website-leads] push failed", err);
  }
}
