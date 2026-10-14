/**
 * Pure detector for "this message talks about money, a discount or a promise".
 * Such text is never sent by the AI on its own: send_reply (and the variables of
 * send_template) turn it into an approval request for a human.
 *
 * It is a deliberately CONSERVATIVE keyword/pattern net, not a security
 * boundary against an adversarial writer: a false positive only costs a human
 * glance, a false negative lets an unapproved price out. When in doubt, flag.
 * Indian formats are covered on purpose (₹, Rs., INR, 1,50,000, 5k, 2.5 lakh,
 * crore, 5000/-, "per sq ft", a few Hinglish price words).
 */
export type GuardCategory = "price" | "discount" | "commitment";

export type GuardResult = {
  flagged: boolean;
  categories: GuardCategory[];
  /** A few short snippets that triggered the guard (for the approver; never sent anywhere). */
  matches: string[];
};

const PATTERNS: { category: GuardCategory; re: RegExp }[] = [
  // ---- price / amounts -----------------------------------------------------
  { category: "price", re: /₹/ },
  { category: "price", re: /\brs\b\.?|\brs\.?\s*\d/ },
  { category: "price", re: /\binr\b|\binr\s*\d/ },
  { category: "price", re: /\$\s?\d|\busd\b|\bdollars?\b/ },
  { category: "price", re: /\brupees?\b|\brupaye\b|\brupiya\b|\brupay[ae]\b|रुपय|रूपय|रुपया/ },
  { category: "price", re: /\b(?:lakhs?|lacs?|crores?|karods?|hazaa?r|hajar)\b/ },
  { category: "price", re: /\b\d[\d,]*(?:\.\d+)?\s*(?:k|cr|thousand|million|mn)\b/ },
  // 25,000 / 1,50,000 / 12,34,567 (but not "1,200 sq ft" style measurements)
  {
    category: "price",
    re: /\b\d{1,3}(?:,\d{2,3})+\b(?!\s*(?:sq|square|sft|ft|feet|foot|m2|mtr|mtrs|meters?|metres?|kg))/,
  },
  { category: "price", re: /\d\s*\/\s*-/ },
  { category: "price", re: /\d\s*(?:\/|per)\s*(?:sq|square|sft|sqft|sqm|unit|piece|pc|hour|hr|month|day)\b/ },
  {
    category: "price",
    re: /\b(?:price[sd]?|pricing|cost(?:s|ing|ly)?|rates?|charges?|charged|fees?|payable|payments?|amount|emi|gst|cheap(?:er|est)?|expensive|affordable|pricey|kimat|keemat|qeemat|daam|bhaa?v|kharch\w*)\b/,
  },
  // ---- discounts / offers --------------------------------------------------
  { category: "discount", re: /%|\bper\s*cent\b|\bpercent(?:age)?\b/ },
  {
    category: "discount",
    re: /\bdiscount(?:s|ed)?\b|\boffers?\b|\boffered\b|\boff\b|\bcashback\b|\bcoupons?\b|\bpromo(?:s|tion|tional)?\b|\bscheme\b|\bwaive[ds]?\b|\bwaiver\b|\bconcession\b|\bfreebies?\b|\bcomplimentary\b/,
  },
  {
    category: "discount",
    re: /\bfor\s+free\b|\bfree\s+(?:of\s+charge|delivery|shipping|installation|install|site|visit|gift|trial|sample|quote|estimate|consultation|design|replacement|service|maintenance)\b|\bat\s+no\s+(?:extra\s+)?(?:cost|charge)s?\b|\bno\s+extra\s+charges?\b/,
  },
  // ---- commitments / promises ---------------------------------------------
  {
    category: "commitment",
    re: /\bwarrant(?:y|ies|ied)\b|\bguarant(?:ee|ees|eed|eeing|y)\b|\bdeadlines?\b|\bpromis(?:e|es|ed|ing)\b|\bassur(?:e|es|ed|ance)\b|\bcommit(?:s|ted|ting|ment|ments)?\b|\brefunds?\b|\bpenalt(?:y|ies)\b/,
  },
  { category: "commitment", re: /\bdelivery\s+(?:date|time(?:line|frame)?|schedule|by|on|within)\b/ },
  { category: "commitment", re: /\binstall(?:ation|ed|ing)?\s+(?:date|by|on|within|before|time(?:line)?|schedule)\b/ },
  {
    category: "commitment",
    re: /\b(?:deliver|install|complete|finish|handover|hand\s+over|dispatch|ship|ready|commission)(?:ed|ing|s)?\s+(?:it\s+|them\s+|the\s+\w+\s+)?(?:by|before|within|on\s+(?:the\s+)?(?:\d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|next\s+week|end\s+of))\b/,
  },
  { category: "commitment", re: /\bconfirm(?:ed|ing|s)?\b[^.!?\n]{0,40}\bdates?\b|\bdates?\b[^.!?\n]{0,40}\bconfirm(?:ed|ing|s)?\b/ },
  {
    category: "commitment",
    re: /\bwithin\s+(?:\d+|a|an|one|two|three|four|five|six|seven|ten|few)\s*(?:business\s+|working\s+)?(?:days?|weeks?|months?|hours?|hrs?)\b/,
  },
];

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

export function normaliseForGuard(text: string): string {
  return text.normalize("NFKC").replace(ZERO_WIDTH, "").toLowerCase();
}

export function detectSensitiveContent(text: string): GuardResult {
  const norm = normaliseForGuard(text ?? "");
  const categories = new Set<GuardCategory>();
  const matches: string[] = [];
  for (const { category, re } of PATTERNS) {
    const m = re.exec(norm);
    if (!m) continue;
    categories.add(category);
    if (matches.length < 5) matches.push(m[0].trim().slice(0, 40));
  }
  return { flagged: categories.size > 0, categories: [...categories], matches };
}

export const NEEDS_APPROVAL_REASON = "needs_approval_price_or_commitment";
