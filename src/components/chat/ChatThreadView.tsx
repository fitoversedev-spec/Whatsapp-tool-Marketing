"use client";

// One thread: the message list + composer. Reused by the floating panel and by
// the "Team chat" tab on a customer/deal page. Fetches on mount, marks the
// thread read, polls for new messages while open, and refetches after sending.
import { useCallback, useEffect, useRef, useState } from "react";
import MediaPreview from "@/components/MediaPreview";
import MessageBody from "./MessageBody";
import MessageComposer from "./MessageComposer";
import { categorizeChips } from "@/lib/chat/tokens";

type Attachment = { id: string; fileName: string; fileUrl: string; fileSize: number; mimeType: string; category: string };
type Message = {
  id: string; authorId: string; authorName: string; mine: boolean;
  body: string | null; createdAt: string; attachments: Attachment[];
};

const POLL_MS = 12000;

export default function ChatThreadView({
  entityType,
  entityId,
  onRead,
  paused = false,
}: {
  entityType: "account_contact" | "deal" | "team" | "dm";
  entityId: string;
  // Fired after the thread is marked read so a parent (the launcher) can
  // refresh its unread badge.
  onRead?: () => void;
  // True while the floating panel is minimized: no polling, no read receipts.
  paused?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The message list we last marked read — the read receipt (PATCH /read +
  // badge refresh) is only sent again when something new has arrived.
  const readKey = useRef<string | null>(null);

  const base = `/api/chat/threads/${entityType}/${entityId}`;

  const markRead = useCallback(async () => {
    try {
      const res = await fetch(`${base}/read`, { method: "PATCH" });
      onRead?.();
      return res.ok;
    } catch {
      return false;
    }
  }, [base, onRead]);

  const load = useCallback(
    async (opts?: { markReadAfter?: boolean }) => {
      try {
        const res = await fetch(`${base}/messages`);
        if (!res.ok) {
          setError(res.status === 403 ? "You don't have access to this chat." : "Could not load messages.");
          return;
        }
        const data = await res.json();
        const list: Message[] = data.messages ?? [];
        setError(null);
        setMessages(list);
        const key = `${list.length}:${list[0]?.id ?? ""}:${list[list.length - 1]?.id ?? ""}`;
        if (opts?.markReadAfter && key !== readKey.current) {
          void markRead().then((ok) => {
            if (ok) readKey.current = key;
          });
        }
      } catch {
        setError("Could not load messages.");
      } finally {
        setLoading(false);
      }
    },
    [base, markRead],
  );

  // A different thread → show the loader and send it a fresh read receipt.
  useEffect(() => {
    setLoading(true);
    readKey.current = null;
  }, [entityType, entityId]);

  // Fetch now and every POLL_MS while the tab is visible. Paused while the
  // floating panel is minimized; reopening it catches up straight away.
  useEffect(() => {
    if (paused) return;
    load({ markReadAfter: true });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load({ markReadAfter: true });
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, paused]);

  useEffect(() => {
    // Stick to the bottom as messages arrive.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50">
        {loading ? (
          <div className="text-center text-xs text-slate-400 py-6">Loading…</div>
        ) : error ? (
          <div className="text-center text-xs text-red-500 py-6">{error}</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-xs text-slate-400 py-6">No messages yet — start the conversation.</div>
        ) : (
          messages.map((m) => {
            const tags = categorizeChips(m.body);
            return (
              <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-xl px-3 py-1.5 ${m.mine ? "bg-wa-green/15" : "bg-white border border-slate-200 shadow-sm"}`}>
                  {!m.mine && <div className="text-[11px] font-semibold text-wa-dark mb-0.5">{m.authorName}</div>}
                  {m.body && (
                    <div className="text-sm text-slate-800">
                      <MessageBody body={m.body} />
                    </div>
                  )}
                  {m.attachments.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {m.attachments.map((a) => (
                        <MediaPreview key={a.id} url={a.fileUrl} mimeType={a.mimeType} fileName={a.fileName} size={a.fileSize} />
                      ))}
                    </div>
                  )}
                  {tags.length > 0 && (
                    <div className="mt-1 pt-1 border-t border-slate-200 space-y-0.5">
                      {tags.map((g) => (
                        <div key={g.refType} className="text-[11px] leading-tight text-slate-500">
                          <span className="font-semibold text-slate-600">{g.category}:</span> {g.items.map((i) => i.label).join(", ")}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-400 mt-0.5 text-right">
                    {new Date(m.createdAt).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {!error && (
        <MessageComposer
          entityType={entityType}
          entityId={entityId}
          initialCustomerContext={entityType === "account_contact" ? entityId : null}
          initialPersonContext={entityType === "dm" ? entityId : null}
          onSent={() => load({ markReadAfter: true })}
        />
      )}
    </div>
  );
}
