// Formatting helpers for turning product data into WhatsApp-ready text.
// Moved out of the (now-removed) MVPv2 client so the chatbot + PDF can
// share them without depending on the sibling tool.

// Convert rich-text HTML descriptions into text WhatsApp renders
// cleanly. WhatsApp formatting: *bold*, _italic_, • bullets, spec
// tables → "key · value" rows. Keeps content, drops layout. Idempotent
// when passed plain text.
export function htmlToWhatsappText(html: string): string {
  if (!html) return "";
  let s = html;

  // Headings first — before the generic close-tag handler so the
  // closing `*` isn't eaten. WhatsApp uses *bold*.
  s = s.replace(/<(h[1-6])[^>]*>\s*/gi, "\n*");
  s = s.replace(/\s*<\/(h[1-6])>/gi, "*\n");

  // Inline formatting.
  s = s.replace(/<(strong|b)[^>]*>/gi, "*");
  s = s.replace(/<\/(strong|b)>/gi, "*");
  s = s.replace(/<(em|i)[^>]*>/gi, "_");
  s = s.replace(/<\/(em|i)>/gi, "_");

  // Table cells → " · " so key/value pairs stay readable.
  s = s.replace(/<\/(th|td)>\s*<(th|td)[^>]*>/gi, " · ");
  s = s.replace(/<(th|td)[^>]*>/gi, "");
  s = s.replace(/<\/(th|td)>/gi, "");
  s = s.replace(/<\/tr>/gi, "\n");
  s = s.replace(/<(tr|table|tbody|thead|colgroup)[^>]*>/gi, "");
  s = s.replace(/<\/(table|tbody|thead|colgroup)>/gi, "");
  s = s.replace(/<col[^>]*\/?>/gi, "");

  // List items.
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<\/li>/gi, "\n");
  s = s.replace(/<(ul|ol)[^>]*>/gi, "");
  s = s.replace(/<\/(ul|ol)>/gi, "");

  // Generic blocks.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div)\s*>/gi, "\n");
  s = s.replace(/<(p|div)[^>]*>/gi, "");

  // Drop everything else.
  s = s.replace(/<[^>]+>/g, "");

  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&rsquo;": "'",
    "&lsquo;": "'",
    "&ldquo;": '"',
    "&rdquo;": '"',
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
  };
  s = s.replace(/&[a-z#0-9]+;/gi, (m) => entities[m] ?? m);

  s = s
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();

  return s;
}

// Product specs JSON → WhatsApp-friendly key/value block. Skips empties.
export function specsToWhatsappBlock(
  specs: Record<string, string> | null | undefined,
): string {
  if (!specs) return "";
  const lines: string[] = [];
  for (const [key, val] of Object.entries(specs)) {
    if (!val || !val.trim()) continue;
    const label = key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
    lines.push(`• *${label}:* ${val.trim()}`);
  }
  return lines.join("\n");
}

// Plain-text version (no WhatsApp markers) — used by the PDF generator.
export function htmlToPlainText(html: string): string {
  return htmlToWhatsappText(html)
    .replace(/\*/g, "")
    .replace(/_/g, "")
    .trim();
}
