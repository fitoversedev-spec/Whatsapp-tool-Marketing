"use client";

// The always-on team-chat bubble, mounted globally in the dashboard and CRM
// layouts so it sits bottom-right on every page (like a website's WhatsApp
// widget). Shows an unread badge, opens the ChatPanel, and supports minimize
// (hide, keep the panel's place) vs close (unmount, reset). Its counts come from
// the shared badge poller the sidebar also reads (src/lib/live-counts.ts) — one
// request for both, no extra round-trip.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { refreshLiveCounts, subscribeLiveCounts } from "@/lib/live-counts";

// The panel's code is only downloaded the first time someone opens chat.
const ChatPanel = dynamic(() => import("./ChatPanel"), {
  ssr: false,
  loading: () => (
    <div className="fixed z-[60] flex items-center justify-center bg-white shadow-2xl border border-slate-200 inset-0 w-full h-full md:inset-auto md:right-4 md:bottom-4 md:w-[380px] md:h-[560px] md:rounded-2xl text-sm text-slate-400">
      Loading chat…
    </div>
  ),
});

function refreshCounts() {
  void refreshLiveCounts({ ignoreFresh: true });
}

export default function FloatingChatLauncher({
  initialUnread = 0,
  initialMentions = 0,
  initialRequests = 0,
}: {
  initialUnread?: number;
  initialMentions?: number;
  initialRequests?: number;
}) {
  const [mounted, setMounted] = useState(false); // panel exists (open or minimized)
  const [visible, setVisible] = useState(false); // panel shown
  const [unread, setUnread] = useState(initialUnread);
  const [mentions, setMentions] = useState(initialMentions);
  const [requests, setRequests] = useState(initialRequests);
  // On the Inbox the reply box sits at the bottom right; on desktop lift the
  // bubble above it (and above the Ask AI button at md:bottom-20) so it never
  // covers the Send button.
  const onInbox = usePathname()?.startsWith("/inbox") ?? false;

  useEffect(
    () =>
      subscribeLiveCounts((c) => {
        setUnread(c.chatUnread ?? 0);
        setMentions(c.chatMentions ?? 0);
        setRequests(c.chatRequests ?? 0);
      }),
    []
  );

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
          rendered visible when open. Minimized = paused: no polling and
          nothing gets marked read behind the user's back. */}
      {mounted && (
        <div className={visible ? "" : "hidden"}>
          <ChatPanel
            paused={!visible}
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
          className={`fixed bottom-20 ${onInbox ? "md:bottom-36" : "md:bottom-4"} right-4 z-40 w-14 h-14 rounded-full bg-wa-green hover:bg-wa-green/90 text-white shadow-lg flex items-center justify-center text-2xl transition`}
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
