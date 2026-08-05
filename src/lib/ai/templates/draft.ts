// AI-assisted WhatsApp template drafting (Feature 1, internal-assist only).
// Produces an editable draft a human reviews and submits to Meta — nothing
// here is ever sent to a customer. The heavy, stable parts of the prompt
// (brand voice + WhatsApp template rules + product grounding) are prompt-
// cached so repeat drafts for the same sport/tone are cheap.
import { generateStructured } from "@/lib/ai/structured";
import { prisma } from "@/lib/prisma";
import { listProducts } from "@/lib/products/store";
import {
  htmlToWhatsappText,
  specsToWhatsappBlock,
} from "@/lib/products/format";

export type TemplateTone = "professional" | "friendly" | "urgent";

export type TemplateHeader = { format: "TEXT"; text: string } | null;

export type TemplateDraft = {
  name: string;
  language: "en";
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  body: string;
  footer: string | null;
  header: TemplateHeader;
};

export type DraftTemplateInput = {
  userId: string;
  brief: string;
  sport?: string;
  tone?: TemplateTone;
};

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;

// JSON Schema for the forced-tool response. Mirrors the create schema in
// src/app/api/templates/route.ts (header kept TEXT-or-null for v1).
const draftSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description:
        "Template name in lowercase snake_case (only a-z, 0-9 and underscores), e.g. turf_enquiry_followup. Max 512 chars.",
    },
    language: {
      type: "string",
      enum: ["en"],
      description: "Always the string \"en\".",
    },
    category: {
      type: "string",
      enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
      description:
        "MARKETING for promotions/offers/announcements; UTILITY for transactional follow-ups tied to a prior interaction (no promo copy); AUTHENTICATION for one-time codes only.",
    },
    body: {
      type: "string",
      description:
        "The message body, 1 to 1024 characters. Use {{1}}, {{2}} placeholders for personalised variables (customer name, sport, date). Keep it human and on-brand.",
    },
    footer: {
      type: ["string", "null"],
      description:
        "Optional short footer (max 60 chars), e.g. a brand sign-off. Null when not needed. Never put variables in the footer.",
    },
    header: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        format: { type: "string", enum: ["TEXT"] },
        text: {
          type: "string",
          description: "Short TEXT header, max 60 chars. May contain one {{1}} variable.",
        },
      },
      required: ["format", "text"],
      description: "Optional TEXT header, or null when no header is needed.",
    },
  },
  required: ["name", "language", "category", "body", "footer", "header"],
};

const BRAND_VOICE = `You are the template-writing assistant for Fitoverse, a sports-infrastructure company in India that designs and builds sports courts, turfs and premium flooring (football turf, cricket nets, basketball, pickleball, tennis, badminton, volleyball and multisport arenas).

Brand voice: warm and human, but professional and credible — you speak like a knowledgeable partner helping a customer build their dream court, not a pushy salesperson. Concrete over hype. Respect the reader's time. Indian English, INR when money is mentioned.`;

const WHATSAPP_RULES = `You draft WhatsApp Business message templates that a Fitoverse team member will review and submit to Meta for approval. Follow Meta's template rules exactly, or the template will be rejected:

CATEGORY — pick the single best fit:
- MARKETING: promotions, offers, new-product announcements, re-engagement, invitations. Most sales outreach is MARKETING.
- UTILITY: transactional follow-ups tied to a specific prior interaction the customer already had (order/quote updates, site-visit or appointment reminders, payment receipts). UTILITY must contain NO promotional or marketing copy — no offers, no "check out", no upselling.
- AUTHENTICATION: one-time passcodes / verification only. Do not use for anything else.

VARIABLES:
- Personalise with numbered placeholders {{1}}, {{2}}, {{3}} in order. Example: "Hi {{1}}, your {{2}} court quote is ready." where {{1}} is a customer name (e.g. "Rahul") and {{2}} a sport (e.g. "pickleball").
- Never start or end the body with a variable, never place two variables back-to-back, and keep the count small (usually 1–3).

LIMITS (hard):
- body: 1–1024 characters.
- footer: optional, max 60 characters, plain text, no variables.
- header: optional; for v1 use only a short TEXT header (max 60 chars) or no header at all (null). Never use image/video/document headers.

STYLE:
- No spammy ALL-CAPS, no excessive emoji (0–2 tasteful emoji max), no misleading claims.
- Make the draft feel finished and human — a rep should be able to submit it with light edits.`;

function toneGuidance(tone?: TemplateTone): string {
  switch (tone) {
    case "friendly":
      return "Requested tone: friendly — warm, approachable and conversational, first-name feel, still professional.";
    case "urgent":
      return "Requested tone: urgent — time-sensitive and action-driving (a clear deadline or next step), but never pushy, alarmist or spammy.";
    case "professional":
      return "Requested tone: professional — polished, precise and businesslike, confident without being stiff.";
    default:
      return "Requested tone: professional and warm.";
  }
}

// Compact, prompt-cache-friendly catalogue digest so the model can ground
// copy in real Fitoverse products (specs, positioning) rather than invent.
async function buildProductDigest(sport?: string): Promise<string> {
  let products: Awaited<ReturnType<typeof listProducts>> = [];
  try {
    products = await listProducts(sport ? { sport } : undefined);
  } catch {
    products = [];
  }
  if (!products.length) {
    return "Product catalogue: no specific catalogue entries available for this request — rely on general Fitoverse sports-infrastructure knowledge and keep product claims generic.";
  }

  const blocks: string[] = [];
  for (const p of products.slice(0, 12)) {
    const desc = htmlToWhatsappText(p.description || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    const specs = specsToWhatsappBlock(p.specs)
      .split("\n")
      .slice(0, 6)
      .join("\n");
    const meta = [p.type, p.category, p.sports.join("/")]
      .filter(Boolean)
      .join(" · ");
    const lines = [`• ${p.name}${meta ? ` (${meta})` : ""}`];
    if (desc) lines.push(`  ${desc}`);
    if (specs) lines.push(specs.replace(/^/gm, "  "));
    blocks.push(lines.join("\n"));
  }

  const scope = sport ? ` (filtered to ${sport})` : "";
  return `Fitoverse product catalogue${scope} — ground any product references in these real entries; do not invent specs or products:\n\n${blocks.join("\n\n")}`;
}

// "What's worked before" grounding — the team's best-performing past broadcasts
// (by WhatsApp read rate) + recently Meta-APPROVED templates, so the model
// mirrors proven structure/tone/length and compliant style. Best-effort: any DB
// hiccup degrades to an empty string (dropped from the prompt) rather than
// blocking a draft.
async function buildPerformanceDigest(): Promise<string> {
  try {
    const [broadcasts, approved] = await Promise.all([
      prisma.broadcast.findMany({
        where: { status: "completed", delivered: { gt: 0 } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          name: true,
          delivered: true,
          read: true,
          template: { select: { body: true, category: true } },
        },
      }),
      prisma.template.findMany({
        where: { status: "approved", deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { body: true, category: true },
      }),
    ]);

    const top = broadcasts
      .map((b) => ({ ...b, readRate: b.delivered > 0 ? b.read / b.delivered : 0 }))
      .filter((b) => b.template?.body)
      .sort((a, b) => b.readRate - a.readRate)
      .slice(0, 5);

    const parts: string[] = [];
    if (top.length) {
      const lines = top.map((b) => {
        const pct = Math.round(b.readRate * 100);
        const body = (b.template?.body || "").replace(/\s+/g, " ").trim().slice(0, 220);
        return `• "${b.name}" — ${pct}% read rate (${b.read}/${b.delivered} delivered) · ${b.template?.category}\n  ${body}`;
      });
      parts.push(
        `WHAT'S WORKED — the team's best-performing past broadcasts, highest WhatsApp read rates first. Learn what makes these land (the hook, length, structure, tone, call-to-action) and apply that, but write fresh copy for the new brief; never copy them verbatim:\n${lines.join("\n")}`,
      );
    }
    if (approved.length) {
      const lines = approved.map(
        (t) => `• (${t.category}) ${(t.body || "").replace(/\s+/g, " ").trim().slice(0, 200)}`,
      );
      parts.push(
        `Recently Meta-APPROVED templates (they passed review — follow this compliant style):\n${lines.join("\n")}`,
      );
    }
    if (!parts.length) {
      return "Past-performance data: none yet (no completed broadcasts or approved templates). Rely on WhatsApp best practices: a strong hook in the first line, one focused message, and a single clear call to action.";
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

// Coerce an arbitrary model-supplied name into the create schema's
// /^[a-z0-9_]+$/ (<=512), with a safe fallback.
function sanitizeName(raw: unknown): string {
  const base = typeof raw === "string" ? raw : "";
  let name = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
  if (!name) name = "template_draft";
  return name;
}

function coerceCategory(raw: unknown): TemplateDraft["category"] {
  return (CATEGORIES as readonly string[]).includes(raw as string)
    ? (raw as TemplateDraft["category"])
    : "MARKETING";
}

function coerceFooter(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const f = raw.trim();
  if (!f) return null;
  return f.slice(0, 60);
}

// Keep header TEXT-or-null only (v1). Anything else → null.
function coerceHeader(raw: unknown): TemplateHeader {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as { format?: unknown; text?: unknown };
  if (h.format !== "TEXT") return null;
  if (typeof h.text !== "string") return null;
  const text = h.text.trim();
  if (!text) return null;
  return { format: "TEXT", text: text.slice(0, 60) };
}

function coerceBody(raw: unknown): string {
  const body = typeof raw === "string" ? raw : "";
  const trimmed = body.trim();
  // Guarantee the create schema's 1..1024 bound; a hard cap here is a
  // safety net — the prompt already asks the model to stay in range.
  const bounded = trimmed.slice(0, 1024);
  return bounded || "Hi {{1}}, thanks for reaching out to Fitoverse.";
}

export async function draftTemplate(
  input: DraftTemplateInput,
): Promise<TemplateDraft> {
  const [digest, performance] = await Promise.all([
    buildProductDigest(input.sport),
    buildPerformanceDigest(),
  ]);
  const sportLine = input.sport
    ? `Target sport / context: ${input.sport}.`
    : "Target sport / context: not specified — infer from the brief.";

  const system = [
    BRAND_VOICE,
    WHATSAPP_RULES,
    toneGuidance(input.tone),
    sportLine,
    digest,
    performance,
    "Write ONE template that best fulfils the brief. Return it via the structured response only.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await generateStructured<Partial<TemplateDraft>>({
    feature: "template",
    userId: input.userId,
    system,
    user: input.brief,
    schema: draftSchema,
    cacheSystem: true,
  });

  // Post-process into a value that always satisfies the create schema.
  return {
    name: sanitizeName(raw.name),
    language: "en",
    category: coerceCategory(raw.category),
    body: coerceBody(raw.body),
    footer: coerceFooter(raw.footer),
    header: coerceHeader(raw.header),
  };
}
