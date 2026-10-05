// The contact Timeline's history log (ContactEvent) — every route that
// changes something about a contact records it through here. Best-effort,
// like writeAudit(): a failed history write must never fail the change itself.
import { prisma } from "@/lib/prisma";
import { canManageAllCustomers } from "@/lib/rbac";

export type ContactEventKind =
  | "details_edited"
  | "stage_changed"
  | "rep_changed"
  | "lead_added"
  | "lead_removed"
  | "note_edited"
  | "note_deleted"
  | "next_action_edited"
  | "next_action_done"
  | "next_action_reopened"
  | "next_action_deleted"
  | "insight_edited"
  | "insight_deleted"
  | "file_deleted"
  | "quotation_deleted"
  | "design_deleted";

export type ContactEventInput = {
  contactId: string;
  actorUserId: string | null;
  kind: ContactEventKind;
  summary: string;
  detail?: string | null;
  visibility?: string | null;
  refId?: string | null;
};

export async function logContactEvents(events: ContactEventInput[]): Promise<void> {
  if (!events.length) return;
  await prisma.contactEvent
    .createMany({
      data: events.map((e) => ({
        accountContactId: e.contactId,
        actorUserId: e.actorUserId,
        kind: e.kind,
        summary: e.summary,
        detail: e.detail ?? null,
        visibility: e.visibility ?? null,
        refId: e.refId ?? null,
      })),
    })
    .catch((err) => console.error("[contact-events] write failed", err));
}

export function logContactEvent(event: ContactEventInput): Promise<void> {
  return logContactEvents([event]);
}

// A rep's insight is private: its history is visible to that rep and to the
// admins/managers who can read every rep's insight, nobody else.
export function insightVisibility(authorUserId: string): string {
  return `insight:${authorUserId}`;
}

export function canSeeContactEvent(visibility: string | null, viewer: { id: string; role: string }): boolean {
  if (!visibility) return true;
  if (visibility.startsWith("insight:")) {
    return visibility === insightVisibility(viewer.id) || canManageAllCustomers(viewer.role);
  }
  return false;
}

// Plain text of a rich-text (HTML) insight, for Timeline titles.
export function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

// "Phone: 98400… → 98410…" lines for a details edit; unchanged pairs are dropped.
export function describeChanges(pairs: [label: string, before: string | null | undefined, after: string | null | undefined][]): string[] {
  const show = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "—");
  return pairs
    .filter(([, before, after]) => show(before) !== show(after))
    .map(([label, before, after]) => `${label}: ${show(before)} → ${show(after)}`);
}

// First line of a note/next action, shortened for a Timeline title.
export function excerpt(text: string, max = 80): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
