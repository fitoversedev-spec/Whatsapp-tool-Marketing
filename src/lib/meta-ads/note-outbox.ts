// Browser-side safety net for the ad-lead Notes box (client code only — uses
// localStorage). Every change to a note being written is kept here until the
// server confirms it, so a save the browser dropped — e.g. the user typed a new
// address or closed the tab mid-save — is sent again on the next page load.
// Saves are PUTs to the note's own id, so sending one twice never makes two
// notes. Entries remember who wrote them and are only sent for that user.

const KEY = "lead-note-outbox";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingNote = {
  userId: string;
  leadId: string;
  noteId: string;
  body: string; // "" = the note should be removed
  at: number;
};

function read(): PendingNote[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.filter(
      (p: PendingNote) => p && p.userId && p.leadId && p.noteId && typeof p.body === "string" && Date.now() - p.at < MAX_AGE_MS,
    );
  } catch {
    return [];
  }
}

function write(list: PendingNote[]) {
  try {
    if (list.length > 0) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage full or blocked — the live save still runs */
  }
}

/** Keep the latest text of a note being written (empty = remove the note). */
export function rememberNote(p: Omit<PendingNote, "at">) {
  write([...read().filter((x) => x.noteId !== p.noteId), { ...p, at: Date.now() }]);
}

/** The server has this text — forget it, unless the box has moved on since. */
export function forgetNote(noteId: string, body: string) {
  const list = read();
  const next = list.filter((x) => !(x.noteId === noteId && x.body === body));
  if (next.length !== list.length) write(next);
}

let flushing = false;

/**
 * Send this user's notes that never got saved. An entry is kept for a later
 * try only when the user is signed out (401), the server failed (5xx) or the
 * network is down; anything else is finished or can never succeed.
 */
export async function flushPendingNotes(userId: string): Promise<void> {
  if (flushing || !userId) return;
  flushing = true;
  try {
    for (const p of read()) {
      if (p.userId !== userId) continue;
      const url = `/api/ad-campaigns/leads/${p.leadId}/notes/${p.noteId}`;
      try {
        const res = p.body
          ? await fetch(url, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ body: p.body }),
              keepalive: true,
            })
          : await fetch(url, { method: "DELETE", keepalive: true });
        if (res.status === 401 || res.status >= 500) continue;
        forgetNote(p.noteId, p.body);
      } catch {
        /* offline — try again next time */
      }
    }
  } finally {
    flushing = false;
  }
}
