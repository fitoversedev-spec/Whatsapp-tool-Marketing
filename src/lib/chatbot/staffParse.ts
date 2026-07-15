// Pure parsing for the WhatsApp staff-command set (spec §10). No I/O here —
// kept separate from staffCommands.ts (which does the DB reads/writes and
// sends replies) so the parsing logic is directly unit-testable.

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseTimeOfDay(raw: string): { hour: number; minute: number } | null {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return null;
  if (ampm) {
    if (hour > 12 || hour < 1) return null;
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  }
  return { hour, minute };
}

// Accepts "today", "tomorrow", "in 2 hours", a weekday name ("friday",
// "next friday"), a bare time ("5pm", "17:30" -> next occurrence of that
// time), or anything Date.parse already understands (ISO dates etc). Must
// consume the WHOLE input — a trailing word that doesn't fit means "not a
// date", so callers can tell "tomorrow 9am" (valid) from "tomorrow 9am call
// the client" (valid prefix, but not on its own) apart.
export function parseNaturalDate(raw: string, now: Date = new Date()): Date | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  const inMatch = text.match(/^in\s+(\d+)\s*(minute|min|hour|hr|day|week)s?\s*$/);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const ms =
      unit.startsWith("min") ? n * 60_000 : unit === "hour" || unit === "hr" ? n * 3_600_000 : unit === "day" ? n * 86_400_000 : n * 7 * 86_400_000;
    return new Date(now.getTime() + ms);
  }

  const dayWordMatch = text.match(/^(today|tomorrow)\s*(.*)$/);
  if (dayWordMatch) {
    const base = new Date(now);
    if (dayWordMatch[1] === "tomorrow") base.setDate(base.getDate() + 1);
    const timePart = dayWordMatch[2].trim();
    const time = timePart ? parseTimeOfDay(timePart) : { hour: 9, minute: 0 };
    if (!time) return null;
    base.setHours(time.hour, time.minute, 0, 0);
    return base;
  }

  const wdMatch = text.match(/^(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*(.*)$/);
  if (wdMatch) {
    const targetDow = WEEKDAYS.indexOf(wdMatch[1]);
    const base = new Date(now);
    let daysAhead = (targetDow - base.getDay() + 7) % 7;
    if (daysAhead === 0) daysAhead = 7; // always the *next* occurrence, never today
    base.setDate(base.getDate() + daysAhead);
    const timePart = wdMatch[2].trim();
    const time = timePart ? parseTimeOfDay(timePart) : { hour: 9, minute: 0 };
    if (!time) return null;
    base.setHours(time.hour, time.minute, 0, 0);
    return base;
  }

  const bareTime = parseTimeOfDay(text);
  if (bareTime) {
    const base = new Date(now);
    base.setHours(bareTime.hour, bareTime.minute, 0, 0);
    if (base.getTime() <= now.getTime()) base.setDate(base.getDate() + 1);
    return base;
  }

  const parsed = Date.parse(raw.trim());
  return isNaN(parsed) ? null : new Date(parsed);
}

export type ParsedCommand =
  | { type: "new_lead"; name: string; city: string; phone: string }
  | { type: "remind"; whenRaw: string; text: string }
  | { type: "my_day" }
  | { type: "deal"; code: string }
  | { type: "stage"; code: string; stageQuery: string }
  | { type: "quote"; code: string }
  | { type: "help" }
  | { type: "confirm_yes" }
  | { type: "confirm_no" }
  | { type: "unrecognized"; raw: string };

export function parseStaffCommand(raw: string, now: Date = new Date()): ParsedCommand {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (["yes", "y", "confirm", "ok", "okay"].includes(lower)) return { type: "confirm_yes" };
  if (["no", "n", "cancel"].includes(lower)) return { type: "confirm_no" };
  if (lower === "help") return { type: "help" };
  if (lower === "my day" || lower === "myday") return { type: "my_day" };

  let m = text.match(/^new\s+lead\s+(.+)$/i);
  if (m) {
    const parts = m[1].trim().split(/\s+/);
    if (parts.length >= 3) {
      const phone = parts[parts.length - 1];
      const city = parts[parts.length - 2];
      const name = parts.slice(0, -2).join(" ");
      if (/^\+?\d[\d\s-]{6,}$/.test(phone)) {
        return { type: "new_lead", name, city, phone: phone.replace(/[\s-]/g, "") };
      }
    }
    return { type: "unrecognized", raw: text };
  }

  m = text.match(/^remind\s+(.+)$/i);
  if (m) {
    const rest = m[1].trim();
    // Explicit delimiter first — unambiguous, preferred when present.
    const delim = rest.match(/^(.+?)\s*[:\-–]\s+(.+)$/);
    if (delim && parseNaturalDate(delim[1], now)) {
      return { type: "remind", whenRaw: delim[1].trim(), text: delim[2].trim() };
    }
    // No delimiter: try progressively shorter word-prefixes as the
    // when-phrase (longest valid match wins, so "next monday 5pm" isn't cut
    // short at just "next monday").
    const words = rest.split(/\s+/);
    for (let take = Math.min(4, words.length - 1); take >= 1; take--) {
      const whenRaw = words.slice(0, take).join(" ");
      const remainder = words.slice(take).join(" ").trim();
      if (remainder && parseNaturalDate(whenRaw, now)) {
        return { type: "remind", whenRaw, text: remainder };
      }
    }
    return { type: "unrecognized", raw: text };
  }

  m = text.match(/^deal\s+(\S+)$/i);
  if (m) return { type: "deal", code: m[1].toUpperCase() };

  m = text.match(/^stage\s+(\S+)\s+(.+)$/i);
  if (m) return { type: "stage", code: m[1].toUpperCase(), stageQuery: m[2].trim() };

  m = text.match(/^quote\s+(\S+)$/i);
  if (m) return { type: "quote", code: m[1].toUpperCase() };

  return { type: "unrecognized", raw: text };
}
