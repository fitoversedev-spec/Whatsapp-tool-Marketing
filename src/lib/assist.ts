// Pure rules for the floating Assist button (src/components/AssistLauncher.tsx):
// which panels it can reach, what a click does, the unread label and the
// screen-reader text. Kept free of React/DOM so they're unit-tested.

export type AssistTarget = "ai" | "chat";

/** Panels this user may open, in menu order (Ask AI first). */
export function assistTargets({ ai, chat }: { ai: boolean; chat: boolean }): AssistTarget[] {
  const out: AssistTarget[] = [];
  if (ai) out.push("ai");
  if (chat) out.push("chat");
  return out;
}

export type AssistClick =
  | { kind: "none" }
  | { kind: "close" } // every panel this user may open is open -> the button is an ×
  | { kind: "open"; target: AssistTarget } // exactly one panel left to open -> no menu
  | { kind: "menu" };

// A panel that is already open doesn't hide the other one: with one open and
// the other still available the click opens it, so AI and chat can sit side by
// side as they did with the old two bubbles.
export function assistClick(targets: AssistTarget[], openTargets: AssistTarget[]): AssistClick {
  if (targets.length === 0) return { kind: "none" };
  const remaining = targets.filter((t) => !openTargets.includes(t));
  if (remaining.length === 0) return { kind: "close" };
  if (remaining.length === 1) return { kind: "open", target: remaining[0] };
  return { kind: "menu" };
}

/** Badge text: "" for nothing, capped at "99+". */
export function unreadLabel(n: number): string {
  if (!(n > 0)) return "";
  return n > 99 ? "99+" : String(Math.floor(n));
}

/** Team-chat unread messages plus pending handoff asks (what the old bubble counted). */
export function assistBadgeCount(unread: number, requests: number): number {
  return Math.max(0, unread || 0) + Math.max(0, requests || 0);
}

export function assistAriaLabel({
  targets,
  openTargets,
  unread,
}: {
  targets: AssistTarget[];
  openTargets: AssistTarget[];
  unread: number;
}): string {
  const name = (t: AssistTarget) => (t === "ai" ? "Ask AI" : "team chat");
  const remaining = targets.filter((t) => !openTargets.includes(t));
  if (openTargets.length > 0 && remaining.length === 0) return `Close ${openTargets.map(name).join(" and ")}`;
  // One panel is open and the other is still available: the button opens it.
  if (openTargets.length > 0) {
    const next = remaining[0];
    const count = next === "chat" ? unreadLabel(unread) : "";
    return count ? `Open ${name(next)} (${count} unread)` : `Open ${name(next)}`;
  }
  const hasAi = targets.includes("ai");
  const hasChat = targets.includes("chat");
  const base = hasAi && hasChat ? "AI assistant and team chat" : hasAi ? "Ask AI" : "Team chat";
  const label = hasChat ? unreadLabel(unread) : "";
  return label ? `${base} (${label} unread)` : base;
}

/** Polite live-region text when the unread count goes up; "" otherwise. */
export function unreadAnnouncement(prev: number, next: number): string {
  return next > prev ? `${unreadLabel(next)} unread in team chat` : "";
}

/** Roving focus inside the menu (wraps at both ends). */
export function nextMenuIndex(
  current: number,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
  count: number
): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (current < 0) return key === "ArrowDown" ? 0 : count - 1;
  return key === "ArrowDown" ? (current + 1) % count : (current - 1 + count) % count;
}

// While any of these is on screen the button hides (it would sit on top of a
// dialog, a right-hand drawer or a bulk-action bar). `data-hides-assist` is the
// opt-in for drawers/bars; `.fixed.inset-0` catches the many full-screen modal
// shells that have no role. The Assist panels are excluded — the button is what
// controls them.
export const ASSIST_HIDE_SELECTOR =
  '[role="dialog"], [aria-modal="true"], [data-hides-assist], .fixed.inset-0:not([data-assist-panel])';
