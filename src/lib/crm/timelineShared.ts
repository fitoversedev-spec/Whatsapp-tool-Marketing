// Timeline constants/types with NO server-only dependencies (no Prisma
// import), split out of timeline.ts so client components can use them
// directly. timeline.ts's own getUnifiedTimeline() is Prisma-backed and
// must only ever be called from Server Components/API routes — but
// CALL_TYPE_NAMES/MEETING_TYPE_NAMES/TimelineEntry are plain values UnifiedTimeline.tsx
// and ContactDetailClient.tsx also need at render time. Importing them from
// timeline.ts itself (even just these two constants) used to pull that
// file's top-level `import { prisma } from "@/lib/prisma"` into the client
// bundle too — webpack bundles a module's full top-level graph regardless of
// which named export you actually use — which crashed the client build
// (Prisma's browser stub can't even be read cleanly under this project's
// OneDrive-sync file locking, see next.config.mjs). Import from HERE in any
// client component; only Server Components/API routes should import
// getUnifiedTimeline from timeline.ts.
export const CALL_TYPE_NAMES = new Set(["Inbound Call", "Outbound Call"]);
export const MEETING_TYPE_NAMES = new Set(["Google Meet", "In-Person Meeting"]);

export type TimelineEntry = {
  id: string;
  kind: "activity" | "reminder" | "created" | "stage";
  title: string;
  detail: string | null;
  timestamp: string; // Activity.occurredAt, Reminder.dueAt, DealStageHistory.changedAt, or the record's own createdAt
  ownerName: string;
  completed?: boolean; // reminders only
  // The underlying ActivityType name (activity and reminder kinds only) —
  // lets the UI show a CALL/MEETING badge instead of a generic
  // ACTIVITY/REMINDER one when it matches CALL_TYPE_NAMES/MEETING_TYPE_NAMES.
  typeName?: string | null;
};

export type TimelineFilter = {
  dealId?: string;
  accountId?: string;
  leadId?: string;
  accountContactId?: string;
};
