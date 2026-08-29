type CrossTabEvent =
  | "crm:contact-added"
  | "crm:deal-updated"
  | "crm:data-changed"
  | "marketing:contact-added"
  | "marketing:data-changed";

type CrossTabMessage = {
  event: CrossTabEvent;
  payload?: Record<string, unknown>;
};

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel("fitoverse-cross-tab");
    } catch {
      return null;
    }
  }
  return channel;
}

export function postCrossTab(event: CrossTabEvent, payload?: Record<string, unknown>) {
  getChannel()?.postMessage({ event, payload } satisfies CrossTabMessage);
}

export function onCrossTab(
  event: CrossTabEvent,
  callback: (payload?: Record<string, unknown>) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};

  function handler(e: MessageEvent<CrossTabMessage>) {
    if (e.data?.event === event) callback(e.data.payload);
  }
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}
