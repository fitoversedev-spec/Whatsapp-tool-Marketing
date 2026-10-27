// "Where did this visitor come from?" One pure classifier shared by the lead
// webhook (what to store on a website lead) and the Google Analytics reports
// (which GA source/medium pairs are AI assistants, search, ads...). It looks at
// the referrer host, the utm_source / utm_medium of the landing URL and which ad
// click id (gclid, fbclid...) was present, and returns a label ("ChatGPT") plus
// the group the label belongs to ("AI assistants").
//
// A recognised utm_source wins over the referrer. An unrecognised one is ignored
// in favour of the referrer, because campaign names ("spring_sale") say nothing
// about the site the visitor was on.

export const SOURCE_GROUPS = [
  "AI assistants",
  "Search",
  "Paid ads",
  "Social",
  "Email",
  "Other websites",
  "Direct",
  "Unknown",
] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];

export const CLICK_IDS = ["gclid", "fbclid", "msclkid", "ttclid", "li_fat_id"] as const;
export type ClickId = (typeof CLICK_IDS)[number];

export type SourceInput = {
  referrerHost?: string | null; // "chatgpt.com"; a "host/path" or full URL is accepted too
  referrerPath?: string | null; // only used to tell bing.com/chat (Copilot) from Bing search
  utmSource?: string | null;
  utmMedium?: string | null;
  clickId?: string | null;
};

export type Classified = { label: string; group: SourceGroup };

type Rule = {
  label: string;
  group: SourceGroup;
  hosts?: (string | RegExp)[]; // a string matches the domain and its subdomains
  names?: string[]; // utm_source spellings (lowercase, spaces / _ / - removed)
};

const AI = "AI assistants" as const;
const AI_RULES: Rule[] = [
  { label: "ChatGPT", group: AI, hosts: ["chatgpt.com", "chat.openai.com", "openai.com"], names: ["chatgpt", "openai"] },
  { label: "Gemini", group: AI, hosts: ["gemini.google.com", "bard.google.com"], names: ["gemini", "bard"] },
  { label: "Perplexity", group: AI, hosts: ["perplexity.ai"], names: ["perplexity"] },
  { label: "Copilot", group: AI, hosts: ["copilot.microsoft.com"], names: ["copilot", "microsoftcopilot", "bingchat"] },
  { label: "Claude", group: AI, hosts: ["claude.ai"], names: ["claude"] },
  { label: "Meta AI", group: AI, hosts: ["meta.ai"], names: ["metaai"] },
  {
    label: "Other AI",
    group: AI,
    hosts: ["poe.com", "you.com", "deepseek.com", "x.ai", "grok.com", "chat.mistral.ai"],
    names: ["poe", "deepseek", "grok", "mistral", "lechat"],
  },
];

const SEARCH_RULES: Rule[] = [
  // google.com, www.google.co.in, google.com.au... but NOT mail.google.com / docs.google.com.
  { label: "Google search", group: "Search", hosts: [/^(www\.|encrypted\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/], names: ["google"] },
  { label: "Bing", group: "Search", hosts: ["bing.com"], names: ["bing"] },
  {
    label: "Other search",
    group: "Search",
    hosts: ["duckduckgo.com", /(^|\.)yahoo\.[a-z.]+$/, /(^|\.)yandex\.[a-z.]+$/, "ecosia.org", "baidu.com"],
    names: ["duckduckgo", "ddg", "yahoo", "yandex", "ecosia", "baidu"],
  },
];

const SOCIAL_RULES: Rule[] = [
  { label: "Instagram", group: "Social", hosts: ["instagram.com"], names: ["instagram", "ig"] },
  { label: "Facebook", group: "Social", hosts: ["facebook.com", "fb.com", "fb.me"], names: ["facebook", "fb"] },
  { label: "YouTube", group: "Social", hosts: ["youtube.com", "youtu.be"], names: ["youtube", "yt"] },
  { label: "LinkedIn", group: "Social", hosts: ["linkedin.com", "lnkd.in"], names: ["linkedin"] },
  { label: "X (Twitter)", group: "Social", hosts: ["x.com", "t.co", "twitter.com"], names: ["twitter", "x"] },
  { label: "WhatsApp", group: "Social", hosts: ["wa.me", "whatsapp.com"], names: ["whatsapp", "wa"] },
  { label: "Pinterest", group: "Social", hosts: [/(^|\.)pinterest\.[a-z.]+$/, "pin.it"], names: ["pinterest"] },
];

const RULES: Rule[] = [...AI_RULES, ...SEARCH_RULES, ...SOCIAL_RULES];
const COPILOT = AI_RULES.find((r) => r.label === "Copilot")!;

// Values GA and UTM tags use for "nothing here".
const NOTHING = new Set(["", "(direct)", "(none)", "(not set)", "(data not available)", "direct", "none"]);

const PAID_MEDIUMS = new Set([
  "cpc", "ppc", "paid", "paidsearch", "paid_search", "paid-search", "paidsocial", "paid_social", "paid-social",
]);
const EMAIL_MEDIUMS = new Set(["email", "e-mail", "newsletter"]);
// Spellings of utm_source (spaces, _ and - removed) that mean Google / Meta advertising.
const GOOGLE_ADS_SOURCES = new Set(["googleads", "adwords"]);
const META_ADS_SOURCES = new Set(["meta", "metaads", "fbads"]);
// Ad networks append these only to ad clicks.
const OTHER_AD_CLICK_IDS = new Set<string>(["msclkid", "ttclid", "li_fat_id"]);

const UNKNOWN: Classified = { label: "Unknown", group: "Unknown" };
const DIRECT: Classified = { label: "Direct", group: "Direct" };

function clean(v: string | null | undefined): string {
  if (typeof v !== "string") return "";
  const s = v.trim().toLowerCase();
  return NOTHING.has(s) ? "" : s;
}

/** "https://www.Bing.com:443/chat?x=1" or "bing.com/chat" -> { host: "bing.com", path: "/chat" }. */
function splitHost(raw: string): { host: string; path: string } {
  const noScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const slash = noScheme.search(/[/?#]/);
  const authority = slash === -1 ? noScheme : noScheme.slice(0, slash);
  const path = slash === -1 ? "" : noScheme.slice(slash);
  const host = authority.replace(/^.*@/, "").replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
  return { host, path };
}

function hostMatches(host: string, rule: Rule): boolean {
  return !!rule.hosts?.some((h) => (typeof h === "string" ? host === h || host.endsWith(`.${h}`) : h.test(host)));
}

/** The rule a referrer host or a utm_source value points at, or null. */
function identify(raw: string, pathHint = ""): Rule | null {
  const { host, path } = splitHost(raw);
  if (!host) return null;
  if (host === "bing.com" && /^\/chat(\/|$|\?)/.test(pathHint || path)) return COPILOT;
  const name = host.replace(/[\s_-]+/g, "");
  return RULES.find((r) => hostMatches(host, r) || r.names?.includes(name)) ?? null;
}

/**
 * Classify one visit. `classify(undefined)` is "Unknown" (a lead saved before
 * the website sent attribution); an attribution with nothing in it is "Direct".
 */
export function classify(input?: SourceInput | null): Classified {
  if (!input) return UNKNOWN;

  const src = clean(input.utmSource);
  const medium = clean(input.utmMedium).replace(/\s+/g, "");
  const click = clean(input.clickId);
  const ref = clean(input.referrerHost);

  // utm_source first; the referrer only when the utm_source says nothing recognisable.
  const rule = (src && identify(src)) || (ref && identify(ref, clean(input.referrerPath))) || null;
  const srcName = src.replace(/[\s_-]+/g, "");

  // Paid ads
  const paid = PAID_MEDIUMS.has(medium);
  if (click === "gclid") return { label: "Google Ads", group: "Paid ads" };
  if (paid && click === "fbclid") return { label: "Meta Ads", group: "Paid ads" };
  if (paid) {
    if (rule?.label === "Google search" || GOOGLE_ADS_SOURCES.has(srcName)) {
      return { label: "Google Ads", group: "Paid ads" };
    }
    if (rule?.label === "Facebook" || rule?.label === "Instagram" || META_ADS_SOURCES.has(srcName)) {
      return { label: "Meta Ads", group: "Paid ads" };
    }
    return { label: "Other ads", group: "Paid ads" };
  }
  if (OTHER_AD_CLICK_IDS.has(click)) return { label: "Other ads", group: "Paid ads" };

  if (EMAIL_MEDIUMS.has(medium)) return { label: "Email", group: "Email" };

  if (rule) return { label: rule.label, group: rule.group };

  // fbclid is added to every click out of Facebook / Instagram, ad or not.
  if (click === "fbclid") return { label: "Facebook", group: "Social" };
  if (src || ref || medium) return { label: "Other website", group: "Other websites" };
  return DIRECT;
}

/**
 * The same, for a Google Analytics session: its sessionSource / sessionMedium
 * ("(direct)" / "(none)" are read as nothing).
 */
export function classifyGaSession(source: string | null | undefined, medium: string | null | undefined): Classified {
  return classify({ utmSource: source, utmMedium: medium });
}

/** The host (without www) and path of a referrer URL, or null when it isn't an http(s) URL. */
export function parseReferrer(raw: string | null | undefined): { host: string; path: string; url: string } | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return host ? { host, path: u.pathname, url: trimmed } : null;
  } catch {
    return null;
  }
}

export const AI_ASSISTANT_LABELS: string[] = AI_RULES.map((r) => r.label);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A (loose) regular expression for a GA sessionSource filter that keeps only
 * rows that might be AI assistants, so those reports stay small. It can match a
 * little too much; the rows are classified again afterwards.
 */
export function aiSourcePattern(): string {
  const parts = AI_RULES.flatMap((r) => [
    ...(r.hosts ?? []).filter((h): h is string => typeof h === "string").map(escapeRegex),
    ...(r.names ?? []).map(escapeRegex),
  ]);
  return [...new Set(parts)].join("|");
}
