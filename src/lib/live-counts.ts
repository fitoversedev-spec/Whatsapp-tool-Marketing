// One shared badge poller for the whole tab. The marketing sidebar, the CRM
// sidebar and the team-chat bubble all read the same /api/unread/count result
// instead of each polling it on its own 15 s timer.
//
// - Polls every 30 s, only while the tab is visible. The poll doubles as the
//   rep's active-time heartbeat (src/lib/usage/heartbeat.ts).
// - No fetch when the page loads: the layout has just rendered fresh counts.
// - A result fetched by another open tab is shared (BroadcastChannel), so a tab
//   coming back into view doesn't re-fetch numbers that are seconds old.
// - A push message from the service worker (src/app/sw.ts) refreshes at once,
//   so badges move as soon as something arrives for users with notifications on.

export type LiveCounts = {
  unread: number;
  reminders: number;
  crmReminders: number;
  chatUnread: number;
  chatMentions: number;
  chatRequests: number;
  pendingTemplates: number;
  tokenExpired: boolean;
};

const POLL_MS = 30_000;

type Listener = (counts: LiveCounts) => void;
const listeners = new Set<Listener>();
let latest: LiveCounts | null = null;
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let channel: BroadcastChannel | null = null;

function publish(counts: LiveCounts, at: number, share: boolean) {
  latest = counts;
  fetchedAt = at;
  listeners.forEach((l) => l(counts));
  if (share) channel?.postMessage({ counts, at });
}

/** Fetch fresh counts now (visible tabs only). `ignoreFresh` skips the "fetched < 30 s ago" check. */
export function refreshLiveCounts({ ignoreFresh = false } = {}): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return Promise.resolve();
  if (!ignoreFresh && Date.now() - fetchedAt < POLL_MS - 2_000) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch("/api/unread/count");
      if (!res.ok) return;
      publish((await res.json()) as LiveCounts, Date.now(), true);
    } catch {
      // Transient network error — the next tick retries.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function onVisibility() {
  if (document.visibilityState === "visible") void refreshLiveCounts();
}

function onWorkerMessage(e: MessageEvent) {
  if (e.data?.type !== "push") return;
  fetchedAt = 0; // counts changed — a hidden tab refreshes as soon as it's shown
  void refreshLiveCounts();
}

function onChannelMessage(e: MessageEvent) {
  const d = e.data as { counts?: LiveCounts; at?: number } | null;
  if (d?.counts && typeof d.at === "number" && d.at > fetchedAt) publish(d.counts, d.at, false);
}

function start() {
  fetchedAt = Date.now(); // the layout's server-rendered counts are fresh
  timer = setInterval(() => void refreshLiveCounts(), POLL_MS);
  document.addEventListener("visibilitychange", onVisibility);
  navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("ccd-live-counts");
    channel.onmessage = onChannelMessage;
  }
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisibility);
  navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
  channel?.close();
  channel = null;
  latest = null;
}

/** Subscribe to badge counts; starts the poller on first use. Returns the unsubscribe function. */
export function subscribeLiveCounts(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  else if (latest) listener(latest);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}
