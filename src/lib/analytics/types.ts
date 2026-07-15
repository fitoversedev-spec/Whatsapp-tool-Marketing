// Shared filter shape across every analytics screen (spec §11.1). Pure
// types only — no Prisma import here, so this stays importable from client
// components too. A narrower slice of the spec's full AnalyticsFilter
// (cities/sportIds/productIds/valueMinPaise etc. get added as the screens
// that actually consume them get built — see docs/DECISIONS.md on not
// pre-building unused surface).
export type AnalyticsFilter = {
  from: Date;
  to: Date;
  ownerIds?: string[];
  leadSourceIds?: string[];
  customerProfileIds?: string[];
  stageIds?: string[];
  outcomes?: ("WON" | "LOST" | "DROPPED")[];
};

// n < this is suppressed as "insufficient data" per spec §8.2 — a couple of
// stalled deals shouldn't be presented as a trustworthy median/average.
export const MIN_SAMPLE_SIZE = 5;
