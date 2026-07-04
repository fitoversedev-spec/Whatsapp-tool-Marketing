// Auto-reply rules. Iterated top-to-bottom by the dispatcher; first
// match wins. Order rules from most-specific to least-specific so a
// message that mentions BOTH the office location AND says "hi" fires
// the location reply (more useful to the customer) rather than the
// generic greeting.
//
// Match shapes:
//   wholeMessage — regex against the entire trimmed body (bare
//     "hi"/"football" — avoids misfiring on "Hi Rajesh")
//   containsAny — any listed substring anywhere in the message
//   customMatch — free-form (body + now); available for time-of-day
//     rules but currently unused (after-hours moved to its own gate)
//
// Response shapes:
//   text — plain sendText body
//   catalogue — media dispatch: look up the uploaded PDF for that
//     sport and send via sendMedia
//
// Cooldown: dispatcher won't fire the same rule for the same contact
// more than once per cooldownHours. Prevents spamming a customer who
// says "hi", we reply, they say "hii", we reply again.

import type { SportKey } from "@/lib/catalogue/sport-meta";

export type TextResponse = { type: "text"; body: string };
export type CatalogueResponse = { type: "catalogue"; sport: SportKey };
export type RuleResponse = TextResponse | CatalogueResponse;

export type AutoReplyRule = {
  id: string;
  name: string;
  active: boolean;
  wholeMessage?: RegExp;
  containsAny?: string[];
  // Free-form matcher — gets body + now. Used for time-of-day rules.
  // When provided, replaces the other matchers.
  customMatch?: (body: string, now: Date) => boolean;
  // Runs after match. Static rules ignore body; dynamic rules (C1)
  // inspect body to pick between text and catalogue.
  buildResponse: (body: string) => RuleResponse;
  cooldownHours: number;
};

// Sports we have Fitoverse-authored catalogue PDFs uploaded for. Sport
// keys not in this list fall back to a "we'll share manually" text so
// the customer isn't left hanging.
const CATALOGUE_SPORTS: SportKey[] = [
  "football",
  "basketball",
  "badminton",
  "pickleball",
  "multisport",
];

// Detect a sport mentioned anywhere in the message. Returns the first
// matched sport (rough priority: specific words before "turf" which is
// football-adjacent but ambiguous).
function detectSport(body: string): SportKey | null {
  const lower = body.toLowerCase();
  const patterns: Array<[RegExp, SportKey]> = [
    [/\bfootball\b|\bsoccer\b/, "football"],
    [/\bcricket\b/, "cricket"],
    [/\bbasketball\b|\bbasket\s*ball\b/, "basketball"],
    [/\btennis\b/, "tennis"],
    [/\bbadminton\b|\bshuttle\b/, "badminton"],
    [/\bvolleyball\b|\bvolley\s*ball\b/, "volleyball"],
    [/\bpickleball\b|\bpickle\s*ball\b/, "pickleball"],
    [/\bmulti\s*[-]?\s*sport(s)?\b/, "multisport"],
    // "turf" alone usually means football — put last as it's ambiguous.
    [/\bturf\b/, "football"],
  ];
  for (const [re, sport] of patterns) {
    if (re.test(lower)) return sport;
  }
  return null;
}

// L1 — Office location + Google Maps.
const LOCATION_RULE: AutoReplyRule = {
  id: "location",
  name: "Office location",
  active: true,
  containsAny: [
    "location",
    "address",
    "office",
    "where are you",
    "where is your",
    "your office",
    "directions",
    "how to reach",
    "map link",
    "google map",
    "google maps",
  ],
  buildResponse: () => ({
    type: "text",
    body: "Fitoverse office address: Ground Floor, Divya Towers, Fort Main Rd, Shevapet, Salem, Tamil Nadu 636001. Google Maps location: https://www.google.com/maps/dir//Fitoverse+Pvt.+Ltd.+(Sports+construction+and+Fitness+Management),+Ground+Floor,+Divya+Towers,+Fort+Main+Rd,+Shevapet,+Salem,+Tamil+Nadu+636001/@11.6686848,78.1221888,13z/data=!4m8!4m7!1m0!1m5!1m1!1s0x3babefb810000001:0x8899513f25af074f!2m2!1d78.1519248!2d11.6538017?entry=ttu&g_ep=EgoyMDI2MDYyOC4wIKXMDSoASAFQAw%3D%3D. Our team is available Monday to Saturday, 9am to 8pm.",
  }),
  cooldownHours: 2,
};

// C1 — Catalogue request. If the customer mentions a sport in the same
// message ("send me the football catalogue"), we send the PDF straight
// away. Otherwise ask which sport and let S1 handle the reply.
const CATALOGUE_RULE: AutoReplyRule = {
  id: "catalogue",
  name: "Catalogue request",
  active: true,
  containsAny: [
    "catalogue",
    "catalog",
    "brochure",
    "portfolio",
    "past project",
    "past projects",
    "past work",
    "sample",
    "sample work",
    "pdf",
  ],
  buildResponse: (body) => {
    const sport = detectSport(body);
    if (sport && CATALOGUE_SPORTS.includes(sport)) {
      return { type: "catalogue", sport };
    }
    return {
      type: "text",
      body: "Sure. Which sport would you like the Fitoverse catalogue for? Reply with the sport name (football, basketball, badminton, pickleball, or multisport) and we will send the catalogue right away.",
    };
  },
  cooldownHours: 4,
};

// S1 — Bare sport keyword. Fires only when the WHOLE trimmed message
// is a sport name, so "we want football turf for our school" doesn't
// accidentally spam a catalogue mid-conversation.
const SPORT_RULE: AutoReplyRule = {
  id: "sport_keyword",
  name: "Sport keyword catalogue",
  active: true,
  wholeMessage:
    /^\s*(football|soccer|cricket|basketball|tennis|badminton|volleyball|pickleball|multi\s*[-]?\s*sport(s)?|turf)[\s!?.,]*$/i,
  buildResponse: (body) => {
    const sport = detectSport(body);
    if (sport && CATALOGUE_SPORTS.includes(sport)) {
      return { type: "catalogue", sport };
    }
    // Cricket, tennis, volleyball — customer named a sport but no
    // catalogue is uploaded for it yet. Acknowledge honestly.
    return {
      type: "text",
      body: "Thanks for your interest. Our team will share the details for that sport shortly. Meanwhile please let us know your plot size and location so we can prepare a quote.",
    };
  },
  cooldownHours: 1,
};

// G1 — Welcome greeting. Fires ONLY when the whole message is a bare
// greeting so it doesn't misfire on "Hi Rajesh, please send the quote".
const GREETING_RULE: AutoReplyRule = {
  id: "greeting",
  name: "Welcome greeting",
  active: true,
  wholeMessage:
    /^\s*(hi+|hey+|hello+|helo+|halo+|namaste+|namaskaram+|namaskar+|vanakkam+|good\s*(morning|afternoon|evening|day)|greetings)(\s+(there|everyone|team|guys|folks|sir|madam|mam|bro|dear))?[\s!?.,\u{1F600}-\u{1F64F}]*$/iu,
  buildResponse: () => ({
    type: "text",
    body: "Welcome to Fitoverse. We are a sports infrastructure company that builds community through sports. We construct football turfs, cricket grounds, basketball and tennis courts, badminton halls, and multi sport facilities. What are you looking to build? Please reply with the sport you are interested in and your plot size, and our team will get back to you within 24 hours.",
  }),
  cooldownHours: 3,
};

// Note: the A1 after-hours rule used to live here. It has been moved to
// src/lib/auto-replies/after-hours-gate.ts, which runs at the top of
// the webhook BEFORE the chatbot flow — so a fresh conversation at 3am
// gets a single "team is offline" ack instead of the interactive menu.

// Order matters — first match wins. Location, then catalogue (may
// consume the sport), then bare sport, then greeting.
export const AUTO_REPLY_RULES: AutoReplyRule[] = [
  LOCATION_RULE,
  CATALOGUE_RULE,
  SPORT_RULE,
  GREETING_RULE,
];

// Runs the rule list against an inbound message body. Returns the first
// matching rule or null. Pure — no side effects, safe to call from
// tests or admin preview screens. Callers pass `now` so time-based
// rules (A1) are deterministic and testable.
export function matchAutoReplyRule(
  body: string | null | undefined,
  now: Date = new Date()
): AutoReplyRule | null {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  for (const rule of AUTO_REPLY_RULES) {
    if (!rule.active) continue;
    if (rule.customMatch && rule.customMatch(trimmed, now)) return rule;
    if (rule.wholeMessage && rule.wholeMessage.test(trimmed)) return rule;
    if (rule.containsAny && rule.containsAny.some((s) => lower.includes(s.toLowerCase()))) {
      return rule;
    }
  }
  return null;
}
