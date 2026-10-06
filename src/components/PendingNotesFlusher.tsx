"use client";

import { useEffect } from "react";
import { flushPendingNotes } from "@/lib/meta-ads/note-outbox";

// On every app page load, sends any ad-lead note this user typed that the
// browser didn't get to save before the previous page closed.
export default function PendingNotesFlusher({ userId }: { userId: string }) {
  useEffect(() => {
    void flushPendingNotes(userId);
  }, [userId]);
  return null;
}
