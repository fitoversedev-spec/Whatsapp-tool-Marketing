// Chat @-mention / record-chip tokens. A ChatMessage.body stores inline tokens
// of the form @[refType:id:label]; MessageBody.tsx renders them as chips, and
// deepLinkFor maps a chip to where clicking it navigates (null = a
// non-navigating pill). This file is the single source of truth for both the
// token grammar and the chip link targets, so the composer, the renderer, and
// the server-side mention extraction never drift.

export type ChatRefType = "user" | "accountContact" | "lead" | "deal" | "quotation" | "courtImage";

export const CHAT_REF_TYPES: ChatRefType[] = ["user", "accountContact", "lead", "deal", "quotation", "courtImage"];

export type ChatToken =
  | { kind: "text"; text: string }
  | { kind: "chip"; refType: ChatRefType; id: string; label: string };

// @[refType:id:label] — id has no ':' or ']'; label has no ']'.
const TOKEN_RE = /@\[([a-zA-Z]+):([^:\]]+):([^\]]*)\]/g;

export function serializeChip(refType: ChatRefType, id: string, label: string): string {
  // Labels can't contain the delimiters — strip so the token stays parseable.
  const safe = label.replace(/[\]:]/g, " ").trim();
  return `@[${refType}:${id}:${safe}]`;
}

export function parseTokens(body: string): ChatToken[] {
  const out: ChatToken[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", text: body.slice(last, idx) });
    const refType = m[1] as ChatRefType;
    if (CHAT_REF_TYPES.includes(refType)) {
      out.push({ kind: "chip", refType, id: m[2], label: m[3] });
    } else {
      // Unknown ref type → leave the raw text so nothing is silently dropped.
      out.push({ kind: "text", text: m[0] });
    }
    last = idx + m[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

// Where a chip navigates when clicked. null = render as a non-navigating pill:
// people have no per-user page, and a court design has no per-record page yet
// (Phase 1 sends those to the Court Designer list).
export function deepLinkFor(refType: ChatRefType, id: string): string | null {
  switch (refType) {
    case "accountContact":
    case "lead":
      return `/crm/contacts/${id}`;
    case "deal":
      return `/deals/${id}`;
    case "quotation":
      return `/api/quotations/${id}/pdf`;
    case "courtImage":
      return `/court-images`;
    case "user":
    default:
      return null;
  }
}

// Human labels for each chip category, used for the per-message "what was
// tagged" summary (e.g. "Sales person: Balaji · Customer: Jay").
export const CHAT_CATEGORY_LABELS: Record<ChatRefType, string> = {
  user: "Sales person",
  accountContact: "Customer",
  lead: "Lead",
  deal: "Deal",
  quotation: "Quotation",
  courtImage: "Court design",
};
const CATEGORY_ORDER: ChatRefType[] = ["user", "accountContact", "lead", "deal", "quotation", "courtImage"];

// Group a message body's chips by category, in a stable order, de-duped — for
// rendering the categorized tag summary beneath a message.
export function categorizeChips(
  body: string | null,
): { refType: ChatRefType; category: string; items: { id: string; label: string }[] }[] {
  if (!body) return [];
  const byType = new Map<ChatRefType, { id: string; label: string }[]>();
  for (const t of parseTokens(body)) {
    if (t.kind !== "chip") continue;
    const arr = byType.get(t.refType) ?? [];
    if (!arr.some((x) => x.id === t.id)) arr.push({ id: t.id, label: t.label });
    byType.set(t.refType, arr);
  }
  return CATEGORY_ORDER.filter((rt) => byType.has(rt)).map((rt) => ({
    refType: rt,
    category: CHAT_CATEGORY_LABELS[rt],
    items: byType.get(rt)!,
  }));
}

// Pull the mention targets out of a body — person mentions (fire the badge)
// kept separate from record chips (deep-link only, no notification).
export function extractMentions(body: string): {
  userIds: string[];
  records: { refType: Exclude<ChatRefType, "user">; id: string }[];
} {
  const userIds: string[] = [];
  const records: { refType: Exclude<ChatRefType, "user">; id: string }[] = [];
  for (const t of parseTokens(body)) {
    if (t.kind !== "chip") continue;
    if (t.refType === "user") userIds.push(t.id);
    else records.push({ refType: t.refType, id: t.id });
  }
  return { userIds: [...new Set(userIds)], records };
}
