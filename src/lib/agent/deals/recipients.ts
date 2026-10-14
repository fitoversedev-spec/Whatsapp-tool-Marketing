import { prisma } from "@/lib/prisma";
import { phoneCandidates } from "../messaging/access";
import { expectedVariableCount, isApprovedStatus } from "../messaging/templates";
import type { Verdict } from "../permissions";

/**
 * Who a campaign may actually reach, and whether its template may be used.
 *
 * Recipients come from saved marketing contacts only (never an uploaded file or
 * a sheet). A contact is dropped when it is opted out, or when allowCampaign is
 * false: the same gates the sender applies when it builds the list, applied
 * here early (at draft time) and again at launch time.
 */
export const GROUP_SCAN_LIMIT = 5000;

export type RecipientSource = { contactIds: string[] } | { groupId: string };
export type ContactLite = { id: string; phone: string; allowCampaign: boolean };

export type RecipientCheck = {
  eligibleIds: string[];
  excluded: { optedOut: number; noCampaignConsent: number; notFound: number };
  /** A group bigger than GROUP_SCAN_LIMIT: not looked at beyond that. */
  truncated: boolean;
};

/** Pure: sort the contacts into eligible and excluded (opt-out outranks missing consent). */
export function classifyRecipients(
  contacts: readonly ContactLite[],
  optedOutPhones: ReadonlySet<string>,
  requestedIds?: readonly string[],
): Omit<RecipientCheck, "truncated"> {
  const seen = new Set<string>();
  const eligibleIds: string[] = [];
  const excluded = { optedOut: 0, noCampaignConsent: 0, notFound: 0 };
  for (const c of contacts) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (phoneCandidates(c.phone).some((p) => optedOutPhones.has(p))) excluded.optedOut += 1;
    else if (!c.allowCampaign) excluded.noCampaignConsent += 1;
    else eligibleIds.push(c.id);
  }
  if (requestedIds) excluded.notFound = new Set(requestedIds.filter((id) => !seen.has(id))).size;
  return { eligibleIds, excluded };
}

export async function resolveRecipients(source: RecipientSource): Promise<RecipientCheck> {
  const byGroup = "groupId" in source;
  const requested = byGroup ? undefined : [...new Set(source.contactIds)];
  const rows = await prisma.contact.findMany({
    where: byGroup ? { groups: { some: { groupId: source.groupId } } } : { id: { in: requested } },
    select: { id: true, phone: true, allowCampaign: true },
    ...(byGroup ? { take: GROUP_SCAN_LIMIT + 1 } : {}),
  });
  const truncated = byGroup && rows.length > GROUP_SCAN_LIMIT;
  const contacts = truncated ? rows.slice(0, GROUP_SCAN_LIMIT) : rows;
  const phones = [...new Set(contacts.flatMap((c) => phoneCandidates(c.phone)))];
  const opt = phones.length
    ? await prisma.optOut.findMany({ where: { phoneE164: { in: phones } }, select: { phoneE164: true } })
    : [];
  return { ...classifyRecipients(contacts, new Set(opt.map((o) => o.phoneE164)), requested), truncated };
}

// ---- the template -----------------------------------------------------------

export type TemplateCheck =
  | { ok: true; category: "UTILITY" | "MARKETING" }
  | { ok: false; code: "template_not_approved" | "template_category_not_allowed" | "marketing_requires_approved_launch"; message: string };

/**
 * Approved and live; UTILITY or MARKETING only. A MARKETING template is allowed
 * because launching is always held for a human, so nothing goes out until a
 * person has approved this exact campaign. `launchVerdict` is that tool's code
 * default: if it were ever ALLOWED, marketing templates would be refused here.
 */
export function checkBroadcastTemplate(
  template: { status: string | null; deletedAt: Date | null; category: string | null },
  launchVerdict: Verdict,
): TemplateCheck {
  if (template.deletedAt || !isApprovedStatus(template.status)) {
    return { ok: false, code: "template_not_approved", message: "This template is not approved by WhatsApp, so it cannot be used." };
  }
  const c = (template.category ?? "").trim().toUpperCase();
  if (c === "UTILITY") return { ok: true, category: "UTILITY" };
  if (c === "MARKETING") {
    if (launchVerdict === "ALLOWED") {
      return {
        ok: false,
        code: "marketing_requires_approved_launch",
        message: "MARKETING templates can only be used while launching a campaign needs human approval.",
      };
    }
    return { ok: true, category: "MARKETING" };
  }
  return { ok: false, code: "template_category_not_allowed", message: "The AI agent may not use templates of this category." };
}

/** Every {{n}} placeholder needs a contact field, and nothing else may be mapped. */
export function validateVariableMapping(
  templateBody: string | null | undefined,
  mapping: Record<string, string>,
): string | null {
  const expected = expectedVariableCount(templateBody);
  const keys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b));
  const want = Array.from({ length: expected }, (_, i) => String(i + 1));
  if (keys.length === want.length && keys.every((k, i) => k === want[i])) return null;
  return expected === 0
    ? "This template has no placeholders, so variableMapping must be empty."
    : `This template has ${expected} placeholder${expected === 1 ? "" : "s"}; variableMapping needs exactly the keys ${want.map((k) => `"${k}"`).join(", ")}.`;
}
