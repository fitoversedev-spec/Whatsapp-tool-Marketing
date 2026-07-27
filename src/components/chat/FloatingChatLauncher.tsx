"use client";

// The always-on team-chat bubble, mounted globally in the dashboard layout so
// it sits bottom-right on every page (like a website's WhatsApp widget). Shows
// an unread badge, opens the ChatPanel, and supports minimize (hide, keep the
// panel's place) vs close (unmount, reset). Polls the same /api/unread/count
// the sidebar uses — one endpoint, no extra round-trip.
import { useEffect, useState } from "react";
import ChatPanel from "./ChatPanel";

export default function FloatingChatLauncher({
  initialUnread = 0,
  initialMentions = 0,
}: {
  initialUnread?: number;
  initialMentions?: number;
}) {
  const [mounted, setMounted] = useState(false); // panel exists (open or minimized)
  const [visible, setVisible] = useState(false); // panel shown
  const [unread, setUnread] = useState(initialUnread);
  const [mentions, setMentions] = useState(initialMentions);
  const [requests, setRequests] = useState(0);

  async function refreshCounts() {
    try {
      const res = await fetch("/api/unread/count");
      if (!res.ok) return;
      const d = await res.json();
      setUnread(d.chatUnread ?? 0);
      setMentions(d.chatMentions ?? 0);
      setRequests(d.chatRequests ?? 0);
    } catch {
      /* transient — ignore */
    }
  }

  // Live-poll every 15s, paused when the tab is hidden — mirrors Sidebar.tsx.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (document.visibilityState === "visible" && !cancelled) refreshCounts();
    };
    tick();
    const timer = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  function openPanel() {
    setMounted(true);
    setVisible(true);
    refreshCounts();
  }

  // Bubble badge counts unread messages + pending handoff asks; mentions or
  // requests turn it red (needs attention) vs a plain unread grey.
  const badge = unread + requests;
  const hasMention = mentions > 0 || requests > 0;

  return (
    <>
      {/* Panel — kept mounted while minimized so its state survives; only
          rendered visible when open. */}
      {mounted && (
        <div className={visible ? "" : "hidden"}>
          <ChatPanel
            onMinimize={() => setVisible(false)}
            onClose={() => {
              setVisible(false);
              setMounted(false);
            }}
            onActivity={refreshCounts}
          />
        </div>
      )}

      {/* Bubble — hidden while the panel is open. */}
      {!visible && (
        <button
          onClick={openPanel}
          aria-label="Open team chat"
          title="Team chat"
          className="fixed bottom-4 right-4 z-40 w-14 h-14 rounded-full bg-wa-green hover:bg-wa-green/90 text-white shadow-lg flex items-center justify-center text-2xl transition"
        >
          💬
          {badge > 0 && (
            <span
              className={`absolute -top-1 -right-1 ${hasMention ? "bg-red-500" : "bg-slate-700"} text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none ring-2 ring-white`}
            >
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </button>
      )}
    </>
  );
}
