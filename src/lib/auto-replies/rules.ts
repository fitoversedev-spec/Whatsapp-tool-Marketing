// Auto-reply rules. Iterated top-to-bottom by the dispatcher; first
// match wins. Order rules from most-specific to least-specific so a
// message that mentions BOTH the office location AND says "hi" fires
// the location reply (more useful to the customer) rather than the
// generic greeting.
//
// Add new rules by pushing entries to AUTO_REPLY_RULES below. Each rule
// is either a `wholeMessage` matcher (regex against the entire trimmed
// message — good for pure greetings like "hi" where "Hi Rajesh, please
// send the quote" must NOT fire) or a `containsAny` matcher (any listed
// substring present anywhere — good for location where "office" or
// "address" anywhere in the message signals intent).
//
// Cooldown: dispatcher won't fire the same rule for the same contact
// more than once per cooldownHours (default 24). Prevents spamming a
// customer who says "hi", we reply, they say "hii", we reply again.

export type AutoReplyRule = {
  id: string;
  name: string;
  active: boolean;
  // Either match against the WHOLE trimmed message (regex) or check if
  // ANY of the listed substrings appear anywhere in the message.
  // Exactly one of these should be provided.
  wholeMessage?: RegExp;
  containsAny?: string[];
  // Response type — only 'text' for now. Later: 'catalogue' (sport PDF),
  // 'template' (approved WhatsApp template).
  responseType: "text";
  responseBody: string;
  cooldownHours: number;
};

// G1 — Welcome greeting. Fires ONLY when the whole message is a bare
// greeting so it doesn't misfire on "Hi Rajesh, please send the quote".
// Broad Indian variants included (namaste, namaskaram, vanakkam).
const GREETING_RULE: AutoReplyRule = {
  id: "greeting",
  name: "Welcome greeting",
  active: true,
  wholeMessage:
    /^\s*(hi+|hey+|hello+|helo+|halo+|namaste+|namaskaram+|namaskar+|vanakkam+|good\s*(morning|afternoon|evening|day)|greetings)(\s+(there|everyone|team|guys|folks|sir|madam|mam|bro|dear))?[\s!?.,\u{1F600}-\u{1F64F}]*$/iu,
  responseType: "text",
  responseBody:
    "Welcome to Fitoverse. We are a sports infrastructure company that builds community through sports. We construct football turfs, cricket grounds, basketball and tennis courts, badminton halls, and multi sport facilities. What are you looking to build? Please reply with the sport you are interested in and your plot size, and our team will get back to you within 24 hours.",
  cooldownHours: 24,
};

// L1 — Office location + Google Maps. Fires when any location-intent
// substring appears anywhere in the message. Covers common phrasings
// like "where is your office", "your address please", "share directions".
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
  responseType: "text",
  responseBody:
    "Fitoverse office address: Ground Floor, Divya Towers, Fort Main Rd, Shevapet, Salem, Tamil Nadu 636001. Google Maps location: https://www.google.com/maps/dir//Fitoverse+Pvt.+Ltd.+(Sports+construction+and+Fitness+Management),+Ground+Floor,+Divya+Towers,+Fort+Main+Rd,+Shevapet,+Salem,+Tamil+Nadu+636001/@11.6686848,78.1221888,13z/data=!4m8!4m7!1m0!1m5!1m1!1s0x3babefb810000001:0x8899513f25af074f!2m2!1d78.1519248!2d11.6538017?entry=ttu&g_ep=EgoyMDI2MDYyOC4wIKXMDSoASAFQAw%3D%3D. Our team is available Monday to Saturday, 9am to 8pm.",
  cooldownHours: 24,
};

// Order matters — first match wins. Location is more specific than the
// bare greeting, so put it first.
export const AUTO_REPLY_RULES: AutoReplyRule[] = [LOCATION_RULE, GREETING_RULE];

// Runs the rule list against an inbound message body. Returns the first
// matching rule or null. Pure — no side effects, safe to call from
// tests or admin preview screens.
export function matchAutoReplyRule(body: string | null | undefined): AutoReplyRule | null {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  for (const rule of AUTO_REPLY_RULES) {
    if (!rule.active) continue;
    if (rule.wholeMessage && rule.wholeMessage.test(trimmed)) return rule;
    if (rule.containsAny && rule.containsAny.some((s) => lower.includes(s.toLowerCase()))) {
      return rule;
    }
  }
  return null;
}
