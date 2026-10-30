"use client";

// The single floating "Assist" button, mounted globally in the dashboard and CRM
// layouts. It replaces the old ✨ Ask AI and 💬 team-chat bubbles: one small
// button opens a menu with both, and picks open the existing AiPanel / ChatPanel
// (dockable, minimizable; minimize keeps a panel's state, close resets it).
// With one panel open the button opens the other (both can sit side by side, as
// before); once every panel is open it turns into an × that minimizes them.
// Chat's unread badge still comes from the shared poller (src/lib/live-counts.ts).
// The button hides itself while a dialog, right-hand drawer or bulk-action bar
// is on screen (see ASSIST_HIDE_SELECTOR in src/lib/assist.ts).
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { refreshLiveCounts, subscribeLiveCounts } from "@/lib/live-counts";
import {
  ASSIST_HIDE_SELECTOR,
  assistAriaLabel,
  assistBadgeCount,
  assistClick,
  assistTargets,
  nextMenuIndex,
  unreadAnnouncement,
  unreadLabel,
  type AssistTarget,
} from "@/lib/assist";

// Each panel's code is only downloaded the first time someone opens it.
const AiPanel = dynamic(() => import("@/components/AiPanel"), {
  ssr: false,
  loading: () => (
    <div
      data-assist-panel
      className="fixed z-50 flex items-center justify-center bg-white shadow-2xl border border-slate-200 inset-0 w-full h-full md:inset-auto md:right-4 md:bottom-[68px] md:w-[440px] md:h-[600px] md:max-h-[calc(100dvh-84px)] md:rounded-2xl md:max-w-[calc(100vw-5rem)] lg:right-[404px] text-sm text-slate-400"
    >
      Loading…
    </div>
  ),
});
const ChatPanel = dynamic(() => import("@/components/chat/ChatPanel"), {
  ssr: false,
  loading: () => (
    <div
      data-assist-panel
      className="fixed z-[60] flex items-center justify-center bg-white shadow-2xl border border-slate-200 inset-0 w-full h-full md:inset-auto md:right-4 md:bottom-[68px] md:w-[380px] md:h-[560px] md:max-h-[calc(100dvh-84px)] md:rounded-2xl text-sm text-slate-400"
    >
      Loading chat…
    </div>
  ),
});

type PanelState = "closed" | "open" | "minimized"; // minimized stays mounted so its state survives

function refreshCounts() {
  void refreshLiveCounts({ ignoreFresh: true });
}

// True while something the button must not sit on top of is visible.
function overlayShowing(): boolean {
  return Array.from(document.querySelectorAll(ASSIST_HIDE_SELECTOR)).some(
    (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"
  );
}

function useOverlayShowing(): boolean {
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      setShowing(overlayShowing());
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "role", "aria-modal", "data-hides-assist"],
    });
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return showing;
}

function ChatSparkleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 8h7a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H9.5L6 20v-3a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M18 2.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8zM18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
    </svg>
  );
}

function BubbleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

function CountPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#C81124] text-white text-[11px] font-bold leading-none">
      {label}
    </span>
  );
}

export default function AssistLauncher({
  initialUnread = 0,
  initialRequests = 0,
  showAi = true,
  showChat = true,
}: {
  initialUnread?: number;
  initialRequests?: number;
  // Who may use what. Both are on for everyone today (the AI report is scoped
  // per user server-side); with only one on, the button opens it directly.
  showAi?: boolean;
  showChat?: boolean;
}) {
  const [aiState, setAiState] = useState<PanelState>("closed");
  const [chatState, setChatState] = useState<PanelState>("closed");
  const [unread, setUnread] = useState(initialUnread);
  const [requests, setRequests] = useState(initialRequests);
  const [menuOpen, setMenuOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuStart = useRef(0); // which item takes focus when the menu opens
  const menuId = useId();
  // On the Inbox the reply box sits at the bottom right: lift the button above
  // it (the offsets live in globals.css so the toast stack follows). Not while a
  // panel is open — the panels sit on top of the composer there anyway.
  const onInbox = usePathname()?.startsWith("/inbox") ?? false;
  const hidden = useOverlayShowing();

  const targets = assistTargets({ ai: showAi, chat: showChat });
  const openTargets: AssistTarget[] = [];
  if (aiState === "open") openTargets.push("ai");
  if (chatState === "open") openTargets.push("chat");
  const anyOpen = openTargets.length > 0;
  const action = assistClick(targets, openTargets);
  const menuMode = action.kind === "menu";
  const badge = assistBadgeCount(unread, requests);
  const showBadge = showChat && badge > 0 && chatState !== "open";

  useEffect(
    () =>
      subscribeLiveCounts((c) => {
        setUnread(c.chatUnread ?? 0);
        setRequests(c.chatRequests ?? 0);
      }),
    []
  );

  // Tell screen readers when chat unread goes up (polite, never the first render).
  const lastBadge = useRef(badge);
  useEffect(() => {
    const text = showChat ? unreadAnnouncement(lastBadge.current, badge) : "";
    lastBadge.current = badge;
    if (text) setAnnouncement(text);
  }, [badge, showChat]);

  const raised = onInbox && !anyOpen;
  useEffect(() => {
    const root = document.documentElement;
    if (raised) root.setAttribute("data-assist-raised", "");
    else root.removeAttribute("data-assist-raised");
    return () => root.removeAttribute("data-assist-raised");
  }, [raised]);

  const closeMenu = useCallback((refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // A dialog/drawer/bulk bar appeared, or the menu has no reason to exist.
  useEffect(() => {
    if ((hidden || !menuMode) && menuOpen) setMenuOpen(false);
  }, [hidden, menuMode, menuOpen]);

  // Focus the first/last item as the menu opens.
  useEffect(() => {
    if (menuOpen) itemRefs.current[menuStart.current]?.focus();
  }, [menuOpen]);

  // Click outside closes the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  function openPanel(target: AssistTarget) {
    if (target === "ai") setAiState("open");
    else {
      setChatState("open");
      refreshCounts();
    }
  }

  function openMenu(startAt: number) {
    menuStart.current = startAt;
    setMenuOpen(true);
  }

  function onButtonClick() {
    if (action.kind === "close") {
      // Minimize, not close: reopening from the menu restores the conversation.
      setAiState((s) => (s === "open" ? "minimized" : s));
      setChatState((s) => (s === "open" ? "minimized" : s));
    } else if (action.kind === "open") openPanel(action.target);
    else if (action.kind === "menu") {
      if (menuOpen) setMenuOpen(false);
      else openMenu(0);
    }
  }

  function onButtonKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!menuMode) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      openMenu(e.key === "ArrowUp" ? targets.length - 1 : 0);
    } else if (e.key === "Escape" && menuOpen) {
      e.preventDefault();
      closeMenu(false);
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      itemRefs.current[nextMenuIndex(current, e.key, targets.length)]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      closeMenu(true);
    }
  }

  function pick(target: AssistTarget) {
    closeMenu(true);
    openPanel(target);
  }

  const label = assistAriaLabel({ targets, openTargets, unread: badge });
  const items: { target: AssistTarget; title: string; hint: string; count: string; icon: React.ReactNode }[] = targets.map((t) =>
    t === "ai"
      ? { target: t, title: "Ask AI", hint: "Questions about your sales data", count: "", icon: <SparkleIcon /> }
      : { target: t, title: "Team chat", hint: "Message your team", count: unreadLabel(badge), icon: <BubbleIcon /> }
  );

  return (
    <>
      {/* Panels — kept mounted while minimized so their state survives; only
          rendered visible when open. A minimized chat is paused: no polling and
          nothing gets marked read behind the user's back. */}
      {aiState !== "closed" && (
        <div className={aiState === "open" ? "" : "hidden"}>
          <AiPanel onMinimize={() => setAiState("minimized")} onClose={() => setAiState("closed")} />
        </div>
      )}
      {chatState !== "closed" && (
        <div className={chatState === "open" ? "" : "hidden"}>
          <ChatPanel
            paused={chatState !== "open"}
            onMinimize={() => setChatState("minimized")}
            onClose={() => setChatState("closed")}
            onActivity={refreshCounts}
          />
        </div>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {!hidden && targets.length > 0 && (
        <div
          ref={wrapRef}
          // On a phone the open panel is full-screen with its own ✕ — the button steps aside.
          className={`fixed z-[45] right-[var(--assist-right)] bottom-[var(--assist-bottom)] flex-col items-end gap-2 ${anyOpen ? "hidden md:flex" : "flex"}`}
        >
          {menuOpen && menuMode && (
            <div
              id={menuId}
              role="menu"
              aria-label="Assist"
              onKeyDown={onMenuKeyDown}
              className="card shadow-lg p-1.5 w-[280px] max-w-[calc(100vw-24px)]"
            >
              {items.map((it, i) => (
                <button
                  key={it.target}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => pick(it.target)}
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-slate-900 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-court-500"
                >
                  <span className="shrink-0 text-slate-600">{it.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold leading-tight">{it.title}</span>
                    <span className="block text-xs text-slate-500">{it.hint}</span>
                  </span>
                  {it.count && <CountPill label={it.count} />}
                </button>
              ))}
            </div>
          )}

          <button
            ref={buttonRef}
            type="button"
            onClick={onButtonClick}
            onKeyDown={onButtonKeyDown}
            aria-label={label}
            title={label}
            aria-haspopup={menuMode ? "menu" : undefined}
            aria-expanded={menuMode ? menuOpen : undefined}
            aria-controls={menuMode && menuOpen ? menuId : undefined}
            className="relative flex items-center justify-center w-[44px] h-[44px] rounded-full border border-transparent bg-[#1C1C1E] text-white shadow-md transition hover:bg-[#2C2C2E] dark:bg-[#2A2A30] dark:border-[#3A3A42] dark:hover:bg-[#34343B] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-court-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#09090b]"
          >
            {action.kind === "close" ? <CloseIcon /> : <ChatSparkleIcon />}
            {showBadge && (
              <span
                aria-hidden="true"
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#C81124] text-white text-[11px] font-bold leading-none flex items-center justify-center ring-2 ring-white dark:ring-[#09090b]"
              >
                {unreadLabel(badge)}
              </span>
            )}
          </button>
        </div>
      )}
    </>
  );
}
