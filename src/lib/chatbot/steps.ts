// Chatbot step definitions. Each step is a pure data record: what to
// send when we enter the step, and what to do when the customer replies.
//
// A step's `send` runs when we ENTER the step (drop the customer onto
// this step). It produces the WhatsApp message that goes out — plain
// text, buttons, or a list.
//
// A step's `advance` runs on the NEXT inbound from that customer. It
// gets the collected data so far + the inbound (text body OR the id of
// a tapped button/list row) and returns the id of the next step, or
// null to end the flow.
//
// Off-script — if the customer types free text on a step that expects
// a button/list tap, advance returns `null` with `endReason: "off_script"`.
//
// Everything is hardcoded here (no admin UI to edit flows) — flows
// change by editing this file and shipping. Small pool of paths so
// this stays maintainable.

import type { SportKey } from "@/lib/catalogue/sport-meta";

// ─── Response shape returned by a step's `send` ──────────────────────

export type SendText = { kind: "text"; body: string };
export type SendButtons = {
  kind: "buttons";
  body: string;
  buttons: Array<{ id: string; title: string }>;
};
export type SendList = {
  kind: "list";
  body: string;
  buttonText: string;
  sections: Array<{
    title?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
};
export type SendCatalogue = { kind: "catalogue"; sport: SportKey };
// Fetch products for `sport` from MVPv2 at runtime and send them one
// image-per-message. If MVPv2 has no products for that sport, fall back
// to a "coming soon" text. Handled by dispatch, not the step's send().
export type SendProductListing = { kind: "product_listing"; sport: SportKey };
// End-of-flow: send one final text, mark flow completed, write BotLead.
export type SendFinal = {
  kind: "final";
  body: string;
};
export type StepSend =
  | SendText
  | SendButtons
  | SendList
  | SendCatalogue
  | SendProductListing
  | SendFinal;

// ─── Result of processing an inbound reply ───────────────────────────

export type AdvanceResult =
  | { next: string; dataPatch?: Record<string, unknown> }
  // End the flow — dispatcher sends the terminal message from the step
  // that returned this, writes the BotLead row, marks flow as ended.
  | { next: null; endReason: "completed" | "off_script"; dataPatch?: Record<string, unknown> };

export type CollectedData = {
  name?: string;
  phone?: string;
  location?: string;
  landSizeFt?: number;
  turfSizeFt?: number;
  sport?: string;
  maintenanceType?: string;
  preferredDateTime?: string; // ISO
  productCategory?: string;
};

export type StepInput = {
  data: CollectedData;
  inboundText: string;
  interactiveReplyId: string | null;
};

export type ChatbotStep = {
  id: string;
  // Produces the outbound when we enter this step. Path is passed in
  // for shared branches that vary slightly by path.
  send: (data: CollectedData) => StepSend;
  // Called on the next inbound from the customer. Return the id of the
  // next step OR terminate the flow.
  advance: (input: StepInput) => AdvanceResult;
};

// ─── Helpers ────────────────────────────────────────────────────────

const OFF_SCRIPT_END = {
  next: null as null,
  endReason: "off_script" as const,
};

const CONTACT_TEAM =
  "Thanks for reaching out. I'll pass this to our team and someone will contact you shortly.";

// Very lenient phone check — just needs at least 6 digits. Meta gives
// us the actual phone in the webhook anyway; this is only to catch
// obvious typos like "abcdef".
function looksLikePhone(text: string): boolean {
  return /\d{6,}/.test(text);
}

// Any positive integer (with optional decimal). Used for size inputs.
function extractNumber(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isFinite(n) && n > 0 ? n : null;
}

// Very loose date/time — anything with a digit + something time-like.
// Store the raw text; sales interprets it.
function looksLikeDateTime(text: string): boolean {
  const t = text.trim();
  return t.length >= 3 && /\d/.test(t);
}

// ─── Step registry ───────────────────────────────────────────────────

const STEPS: Record<string, ChatbotStep> = {};

function register(step: ChatbotStep): void {
  STEPS[step.id] = step;
}

export function getStep(id: string): ChatbotStep | null {
  return STEPS[id] ?? null;
}

// ─── PHASE 0 — Main menu ─────────────────────────────────────────────

register({
  id: "menu",
  send: () => ({
    kind: "list",
    body: "Welcome to Fitoverse! How can we help you today?",
    buttonText: "Choose option",
    sections: [
      {
        rows: [
          {
            id: "menu:turnkey_new",
            title: "Turnkey Projects",
            description: "New court / turf construction",
          },
          {
            id: "menu:maintenance",
            title: "Maintenance",
            description: "Existing court repair / brushing / infill",
          },
          {
            id: "menu:consultation",
            title: "Expert Consultation",
            description: "Book a call with our team",
          },
          {
            id: "menu:product",
            title: "Product Listing",
            description: "Sports materials info (specs, no pricing)",
          },
        ],
      },
    ],
  }),
  advance: ({ interactiveReplyId }) => {
    switch (interactiveReplyId) {
      case "menu:turnkey_new":
        return { next: "p1a_name", dataPatch: {} };
      case "menu:maintenance":
        return { next: "p1b_name", dataPatch: {} };
      case "menu:consultation":
        return { next: "p3_name", dataPatch: {} };
      case "menu:product":
        return { next: "p2_sport", dataPatch: {} };
      default:
        return OFF_SCRIPT_END;
    }
  },
});

// ─── PATH 1A — Turnkey / New Court Building ──────────────────────────

register({
  id: "p1a_name",
  send: () => ({
    kind: "text",
    body: "Great! Let's get you a Fitoverse court. First — what's your name?",
  }),
  advance: ({ inboundText }) => {
    const name = inboundText.trim();
    if (name.length < 2) return OFF_SCRIPT_END;
    return { next: "p1a_phone", dataPatch: { name } };
  },
});

register({
  id: "p1a_phone",
  send: (data) => ({
    kind: "text",
    body: `Thanks ${data.name ?? ""}. What's the best phone number to reach you on?`,
  }),
  advance: ({ inboundText }) => {
    const phone = inboundText.trim();
    if (!looksLikePhone(phone)) return OFF_SCRIPT_END;
    return { next: "p1a_location", dataPatch: { phone } };
  },
});

register({
  id: "p1a_location",
  send: () => ({
    kind: "text",
    body: "Which city or area is the plot in?",
  }),
  advance: ({ inboundText }) => {
    const location = inboundText.trim();
    if (location.length < 2) return OFF_SCRIPT_END;
    return { next: "p1a_size", dataPatch: { location } };
  },
});

register({
  id: "p1a_size",
  send: () => ({
    kind: "text",
    body:
      "What's the plot size? (feet, e.g. 6000 sq.ft OR 100 x 60 ft)",
  }),
  advance: ({ inboundText }) => {
    const n = extractNumber(inboundText);
    if (!n) return OFF_SCRIPT_END;
    return { next: "p1a_sport", dataPatch: { landSizeFt: n } };
  },
});

register({
  id: "p1a_sport",
  send: () => ({
    kind: "list",
    body: "Which sport are you building for?",
    buttonText: "Choose sport",
    sections: [
      {
        rows: [
          { id: "sport:football", title: "Football" },
          { id: "sport:cricket", title: "Cricket + Football" },
          { id: "sport:basketball", title: "Basketball" },
          { id: "sport:pickleball", title: "Pickleball" },
          { id: "sport:badminton", title: "Badminton" },
          { id: "sport:multisport", title: "Multisport" },
        ],
      },
    ],
  }),
  advance: ({ interactiveReplyId }) => {
    if (!interactiveReplyId?.startsWith("sport:")) return OFF_SCRIPT_END;
    const sport = interactiveReplyId.slice("sport:".length);
    return { next: "p1a_send_catalogue", dataPatch: { sport } };
  },
});

// Sends the catalogue PDF via the catalogue helper. dispatch reads the
// kind:"catalogue" response and looks up the sport's PDF URL from the
// Setting table (same as existing C1/S1 auto-reply catalogue path).
register({
  id: "p1a_send_catalogue",
  send: (data) => ({
    kind: "catalogue",
    sport: (data.sport as SportKey) ?? "football",
  }),
  advance: () => ({
    // Immediately advance to the terminal step after the catalogue is
    // sent. There's no inbound to wait for — dispatch chains steps
    // through auto-advance when the response has kind !== list/buttons.
    next: "p1a_end",
  }),
});

register({
  id: "p1a_end",
  send: () => ({
    kind: "final",
    body:
      "We have noted your details. Our team will review and contact you within 24 hours to discuss your project.",
  }),
  advance: () => ({ next: null, endReason: "completed" }),
});

// ─── PATH 1B — Turnkey / Maintenance ─────────────────────────────────

register({
  id: "p1b_name",
  send: () => ({
    kind: "text",
    body: "Let's help you with maintenance. First — what's your name?",
  }),
  advance: ({ inboundText }) => {
    const name = inboundText.trim();
    if (name.length < 2) return OFF_SCRIPT_END;
    return { next: "p1b_phone", dataPatch: { name } };
  },
});

register({
  id: "p1b_phone",
  send: (data) => ({
    kind: "text",
    body: `Thanks ${data.name ?? ""}. What's the best phone number to reach you on?`,
  }),
  advance: ({ inboundText }) => {
    const phone = inboundText.trim();
    if (!looksLikePhone(phone)) return OFF_SCRIPT_END;
    return { next: "p1b_location", dataPatch: { phone } };
  },
});

register({
  id: "p1b_location",
  send: () => ({
    kind: "text",
    body: "Which city or area is the court in?",
  }),
  advance: ({ inboundText }) => {
    const location = inboundText.trim();
    if (location.length < 2) return OFF_SCRIPT_END;
    return { next: "p1b_size", dataPatch: { location } };
  },
});

register({
  id: "p1b_size",
  send: () => ({
    kind: "text",
    body: "What's the turf / court size? (feet)",
  }),
  advance: ({ inboundText }) => {
    const n = extractNumber(inboundText);
    if (!n) return OFF_SCRIPT_END;
    return { next: "p1b_service", dataPatch: { turfSizeFt: n } };
  },
});

register({
  id: "p1b_service",
  send: () => ({
    kind: "list",
    body: "What kind of maintenance do you need?",
    buttonText: "Choose service",
    sections: [
      {
        rows: [
          { id: "maint:brushing", title: "Turf brushing" },
          { id: "maint:rubber_infill", title: "Rubber infill" },
          { id: "maint:silica_infill", title: "Rubber + silica infill" },
          { id: "maint:ppe_tiles", title: "PPE tile replacement" },
          { id: "maint:paint", title: "Primer & painting" },
          { id: "maint:net_post", title: "Net / post / fence" },
          { id: "maint:equipment", title: "Sports equipment" },
          { id: "maint:visit", title: "Expert visit" },
        ],
      },
    ],
  }),
  advance: ({ interactiveReplyId }) => {
    if (!interactiveReplyId?.startsWith("maint:")) return OFF_SCRIPT_END;
    return {
      next: "p1b_end",
      dataPatch: { maintenanceType: interactiveReplyId.slice("maint:".length) },
    };
  },
});

register({
  id: "p1b_end",
  send: () => ({
    kind: "final",
    body:
      "Thanks! Our maintenance team will contact you shortly with next steps.",
  }),
  advance: () => ({ next: null, endReason: "completed" }),
});

// ─── PATH 3 — Consultation ───────────────────────────────────────────

register({
  id: "p3_name",
  send: () => ({
    kind: "text",
    body:
      "Let's schedule a consultation call. First — what's your name?",
  }),
  advance: ({ inboundText }) => {
    const name = inboundText.trim();
    if (name.length < 2) return OFF_SCRIPT_END;
    return { next: "p3_phone", dataPatch: { name } };
  },
});

register({
  id: "p3_phone",
  send: (data) => ({
    kind: "text",
    body: `Thanks ${data.name ?? ""}. What's the best phone number to reach you on?`,
  }),
  advance: ({ inboundText }) => {
    const phone = inboundText.trim();
    if (!looksLikePhone(phone)) return OFF_SCRIPT_END;
    return { next: "p3_location", dataPatch: { phone } };
  },
});

register({
  id: "p3_location",
  send: () => ({
    kind: "text",
    body: "Which city or area are you in?",
  }),
  advance: ({ inboundText }) => {
    const location = inboundText.trim();
    if (location.length < 2) return OFF_SCRIPT_END;
    return { next: "p3_datetime", dataPatch: { location } };
  },
});

register({
  id: "p3_datetime",
  send: () => ({
    kind: "text",
    body:
      "What's a good date and time for our team to call you back? (e.g. Tomorrow 4pm, Fri 11am)",
  }),
  advance: ({ inboundText }) => {
    const raw = inboundText.trim();
    if (!looksLikeDateTime(raw)) return OFF_SCRIPT_END;
    return {
      next: "p3_end",
      dataPatch: { preferredDateTime: raw },
    };
  },
});

register({
  id: "p3_end",
  send: (data) => ({
    kind: "final",
    body: `Perfect! We have noted your callback for ${data.preferredDateTime ?? "the requested time"}. Our team will call you then.`,
  }),
  advance: () => ({ next: null, endReason: "completed" }),
});

// ─── PATH 2 — Product Listing ────────────────────────────────────────
// Reads live from the MVPv2 sibling tool. When MVPv2 has products for
// the sport, we send up to 5 with image + short description. When it
// doesn't, we tell the customer we're finalising and their interest
// still writes a BotLead so sales can follow up.

register({
  id: "p2_sport",
  send: () => ({
    kind: "list",
    body: "Which sport are you interested in?",
    buttonText: "Choose sport",
    sections: [
      {
        rows: [
          { id: "sport:football", title: "Football" },
          { id: "sport:cricket", title: "Cricket" },
          { id: "sport:basketball", title: "Basketball" },
          { id: "sport:pickleball", title: "Pickleball" },
          { id: "sport:badminton", title: "Badminton" },
          { id: "sport:tennis", title: "Tennis" },
          { id: "sport:volleyball", title: "Volleyball" },
          { id: "sport:multisport", title: "Multisport" },
        ],
      },
    ],
  }),
  advance: ({ interactiveReplyId }) => {
    if (!interactiveReplyId?.startsWith("sport:")) return OFF_SCRIPT_END;
    const sport = interactiveReplyId.slice("sport:".length);
    return { next: "p2_send_products", dataPatch: { sport } };
  },
});

// Auto-advance step (no inbound expected). dispatch reads the
// product_listing response, fetches from MVPv2, sends the media
// messages, then jumps straight to p2_end.
register({
  id: "p2_send_products",
  send: (data) => ({
    kind: "product_listing",
    sport: (data.sport as SportKey) ?? "football",
  }),
  advance: () => ({ next: "p2_end" }),
});

register({
  id: "p2_end",
  send: () => ({
    kind: "final",
    body:
      "We have noted your interest. Our team will share the full catalogue and pricing with you within 24 hours. If you already know your plot size and location, reply with them anytime and we'll prepare a tailored quote.",
  }),
  advance: () => ({ next: null, endReason: "completed" }),
});

// ─── Off-script terminal step ────────────────────────────────────────

register({
  id: "off_script",
  send: () => ({
    kind: "final",
    body: CONTACT_TEAM,
  }),
  advance: () => ({ next: null, endReason: "off_script" }),
});

export const STEP_IDS = Object.keys(STEPS);
