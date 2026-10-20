/**
 * Hot / warm / cold for a WhatsApp chat the AI Sales Agent handled.
 *
 * Who decides, strongest first:
 *   human  — someone on the team set it on the AI agent chats page
 *   agent  — the AI agent set it (set_lead_temperature)
 *   auto   — this file, from signals in the chat and the CRM lead
 *
 * Pure (no database) so the rules are easy to test and tune. Points add up;
 * HOT_AT and WARM_AT are the cut-offs.
 */

export const TEMPERATURES = ["HOT", "WARM", "COLD"] as const;
export type Temperature = (typeof TEMPERATURES)[number];
export type TemperatureSource = "human" | "agent" | "auto";

export function isTemperature(v: unknown): v is Temperature {
  return typeof v === "string" && (TEMPERATURES as readonly string[]).includes(v);
}

export const HOT_AT = 60;
export const WARM_AT = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// Lower-case substrings in what the CUSTOMER wrote. English plus common Hinglish.
const BUYING_WORDS = [
  "price",
  "pricing",
  "cost",
  "rate",
  "quote",
  "quotation",
  "estimate",
  "budget",
  "discount",
  "payment",
  "advance",
  "site visit",
  "visit",
  "call me",
  "meeting",
  "urgent",
  "asap",
  "immediately",
  "this month",
  "when can you start",
  "order",
  "confirm",
  "kitna",
  "kitne",
  "kab tak",
];
const COLD_WORDS = ["not interested", "no thanks", "no thank you", "too expensive", "just checking", "not now", "maybe later"];

export type ChatSignals = {
  /** What the customer wrote (newest first is fine; order is not used). */
  customerTexts: string[];
  customerMessageCount: number;
  lastCustomerMessageAt: Date | null;
  /** The customer asked the AI for a person (any handoff request on this chat). */
  askedForHuman: boolean;
  /** Requirement keys the AI captured on the CRM lead (agent.* fields), without the prefix. */
  requirementKeys: string[];
  /** The chat is linked to a CRM lead. */
  inCrm: boolean;
  optedOut: boolean;
};

export type AutoScore = { temperature: Temperature; score: number; signals: string[] };

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word matches only, so "rate" does not fire on "separate". */
function matched(texts: string[], words: string[]): string[] {
  const hay = texts.join("\n").toLowerCase();
  return words.filter((w) => new RegExp(`\\b${escapeRe(w)}\\b`).test(hay));
}

export function scoreChat(s: ChatSignals, now: Date = new Date()): AutoScore {
  if (s.optedOut) return { temperature: "COLD", score: 0, signals: ["Opted out"] };

  let score = 0;
  const signals: string[] = [];
  const add = (points: number, label: string) => {
    score += points;
    signals.push(label);
  };

  if (s.askedForHuman) add(40, "Asked to talk to a person");

  const req = new Set(s.requirementKeys);
  if (req.has("budgetInr")) add(15, "Budget shared");
  if (req.has("timeline")) add(10, "Timeline shared");
  if (req.has("city") || req.has("location")) add(5, "Location shared");
  if (req.has("sport") || req.has("courtLengthFt") || req.has("courtWidthFt")) add(5, "Project details shared");

  const buying = matched(s.customerTexts, BUYING_WORDS);
  if (buying.length) add(20, `Buying words: ${buying.slice(0, 3).join(", ")}`);
  const cold = matched(s.customerTexts, COLD_WORDS);
  if (cold.length) add(-30, `Cold words: ${cold.slice(0, 2).join(", ")}`);

  if (s.customerMessageCount >= 5) add(10, `${s.customerMessageCount} customer messages`);
  else if (s.customerMessageCount >= 2) add(5, `${s.customerMessageCount} customer messages`);
  else if (s.customerMessageCount === 0) add(-10, "Customer has not replied");

  if (s.lastCustomerMessageAt) {
    const age = now.getTime() - s.lastCustomerMessageAt.getTime();
    if (age <= DAY_MS) add(10, "Replied in the last 24 h");
    else if (age > 7 * DAY_MS) add(-15, "Quiet for over a week");
  }

  if (s.inCrm) add(5, "Moved to CRM");

  score = Math.max(0, Math.min(100, score));
  const temperature: Temperature = score >= HOT_AT ? "HOT" : score >= WARM_AT ? "WARM" : "COLD";
  return { temperature, score, signals };
}

/** A person's or the agent's label wins over the automatic one. */
export function finalTemperature(
  auto: AutoScore,
  saved: { temperature: string; source: string; reason: string } | null,
): { temperature: Temperature; source: TemperatureSource; reason: string } {
  if (saved && isTemperature(saved.temperature)) {
    return {
      temperature: saved.temperature,
      source: saved.source === "human" ? "human" : "agent",
      reason: saved.reason,
    };
  }
  return { temperature: auto.temperature, source: "auto", reason: auto.signals.join(" · ") };
}
