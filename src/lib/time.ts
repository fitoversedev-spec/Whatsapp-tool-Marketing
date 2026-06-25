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
