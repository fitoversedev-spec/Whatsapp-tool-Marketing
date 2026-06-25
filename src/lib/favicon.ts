// Browser-only helper: overlay a red dot on the favicon when there are
// unread messages, restore the original when the count drops to 0.
//
// We cache the original favicon URL on first call so we can restore it
// even if multiple call sites toggle the badge.

let originalHref: string | null = null;

function getLink(): HTMLLinkElement | null {
  return (
    document.querySelector<HTMLLinkElement>('link[rel="icon"]') ||
    document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]')
  );
}

export function setFaviconBadge(enabled: boolean) {
  if (typeof window === "undefined") return;
  const link = getLink();
  if (!link) return;
  if (originalHref === null) originalHref = link.href;

  if (!enabled) {
    link.href = originalHref;
    return;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, size, size);
    // Red dot — bottom right, with white outline for contrast.
    ctx.beginPath();
    ctx.arc(size - 16, size - 16, 16, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.stroke();
    link.href = canvas.toDataURL("image/png");
  };
  img.onerror = () => {
    // CORS or load failure — fall back to a generic red square favicon so
    // there's still a visible indicator.
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(0, 0, size, size);
    link.href = canvas.toDataURL("image/png");
  };
  img.src = originalHref;
}
