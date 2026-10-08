"use client";

import { useState, FormEvent } from "react";

// Owns the reply text so typing re-renders only this form, not the whole
// chat list + every message bubble in InboxClient. Deliberately NOT keyed by
// conversation, so a half-typed draft survives switching chats (as before).
export default function ReplyComposer({
  withinWindow,
  sending,
  isClosed,
  onSend,
  onSendMedia,
}: {
  withinWindow: boolean;
  sending: boolean;
  isClosed: boolean;
  // Resolve true on success; the draft is cleared only then, so a failed
  // send keeps the text.
  onSend: (text: string) => Promise<boolean>;
  onSendMedia: (file: File, caption: string) => Promise<boolean>;
}) {
  const [reply, setReply] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    if (await onSend(reply)) setReply("");
  }

  return (
    <form onSubmit={submit} className="border-t border-slate-200 bg-white p-3 sm:p-4 shrink-0">
      <div className="flex gap-2">
        <label
          className={`shrink-0 self-center w-10 h-10 rounded-lg border border-slate-300 flex items-center justify-center cursor-pointer transition ${
            withinWindow && !sending && !isClosed
              ? "hover:border-wa-green hover:bg-slate-50 text-slate-600"
              : "opacity-40 cursor-not-allowed text-slate-400"
          }`}
          title="Attach file"
          data-guide="wa-inbox-attach"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41a2 2 0 01-2.83-2.83l8.49-8.49" />
          </svg>
          <input
            type="file"
            className="hidden"
            accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/*"
            disabled={!withinWindow || sending || isClosed}
            onChange={async (e) => {
              const input = e.target;
              const f = input.files?.[0];
              if (f) {
                // Reset input so the same file can be re-picked
                input.value = "";
                if (await onSendMedia(f, reply)) setReply("");
              }
            }}
          />
        </label>
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={
            isClosed
              ? "Reopen to reply"
              : withinWindow
              ? "Type a reply… (or attach a file)"
              : "24h window closed"
          }
          disabled={!withinWindow || sending || isClosed}
          data-guide="wa-inbox-composer"
          className="flex-1 min-w-0 px-3 sm:px-4 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none disabled:bg-slate-50 disabled:text-slate-400 text-base sm:text-sm"
        />
        <button
          type="submit"
          disabled={!withinWindow || sending || !reply.trim() || isClosed}
          data-guide="wa-inbox-send"
          className="btn btn-primary shrink-0"
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </form>
  );
}
