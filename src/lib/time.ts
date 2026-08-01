// Timezone helpers. The Fitoverse team operates in IST; we deliberately
// hard-code the +5:30 offset rather than relying on server local time
// (Vercel functions run in UTC, which made "today" filters surface the
// wrong reminders).

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Returns the UTC instant that corresponds to 23:59:59.999 *IST* on the
// IST calendar date that contains `at`. Use as the upper bound of a
// "today" range when querying timestamps stored in UTC.
export function endOfDayIST(at: Date = new Date()): Date {
  const asIST = new Date(at.getTime() + IST_OFFSET_MS);
  const istMidnightUtc = Date.UTC(
    asIST.getUTCFullYear(),
    asIST.getUTCMonth(),
    asIST.getUTCDate(),
    23,
    59,
    59,
    999
  );
  return new Date(istMidnightUtc - IST_OFFSET_MS);
}

// Returns the UTC instant for the start of the IST calendar day that
// contains `at`.
export function startOfDayIST(at: Date = new Date()): Date {
  const asIST = new Date(at.getTime() + IST_OFFSET_MS);
  const istMidnightUtc = Date.UTC(
    asIST.getUTCFullYear(),
    asIST.getUTCMonth(),
    asIST.getUTCDate(),
    0,
    0,
    0,
    0
  );
  return new Date(istMidnightUtc - IST_OFFSET_MS);
}

// Returns the UTC instant for the start of the IST *hour* that contains `at`.
// Used as the bucket key for per-hour usage tracking (src/lib/usage/heartbeat.ts)
// so daily totals and the weekday×hour heatmap read cleanly in IST.
export function startOfHourIST(at: Date = new Date()): Date {
  const asIST = new Date(at.getTime() + IST_OFFSET_MS);
  const istHourUtc = Date.UTC(
    asIST.getUTCFullYear(),
    asIST.getUTCMonth(),
    asIST.getUTCDate(),
    asIST.getUTCHours(),
    0,
    0,
    0
  );
  return new Date(istHourUtc - IST_OFFSET_MS);
}

// IST weekday (0=Sun..6=Sat) and hour (0..23) for an instant — the fixed +5:30
// offset means we can read them straight off the shifted UTC fields.
export function istWeekdayHour(at: Date = new Date()): { weekday: number; hour: number } {
  const asIST = new Date(at.getTime() + IST_OFFSET_MS);
  return { weekday: asIST.getUTCDay(), hour: asIST.getUTCHours() };
}

// Start of the current IST work-week (Monday 00:00 IST), as a UTC instant.
// Fixed-offset IST has no DST, so plain millisecond day arithmetic is safe.
export function startOfWeekIST(at: Date = new Date()): Date {
  const dayStart = startOfDayIST(at);
  const { weekday } = istWeekdayHour(at); // 0=Sun..6=Sat
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(dayStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
}
