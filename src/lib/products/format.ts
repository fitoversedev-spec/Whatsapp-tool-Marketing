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

// Extract the FIRST HTML <table> from a description as [col1, col2]
// row pairs, plus the description text with the table removed. Product
// descriptions from the catalogue put specs in a two-column table
// (Specification | Value); the PDF renders those as a real table
// instead of flattening them into messy text.
export function extractHtmlTable(html: string): {
  rows: Array<[string, string]>;
  rest: string;
} {
  if (!html) return { rows: [], rest: "" };
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    return { rows: [], rest: htmlToPlainText(html) };
  }
  const tableHtml = tableMatch[0];
  const rows: Array<[string, string]> = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRegex.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cell: RegExpExecArray | null;
    while ((cell = cellRegex.exec(tr[1])) !== null) {
      cells.push(cleanCell(cell[1]));
    }
    if (cells.length >= 2 && (cells[0] || cells[1])) {
      rows.push([cells[0], cells.slice(1).join(" ")]);
    }
  }
  // Drop a leading header row if it looks like "Specification | Value".
  if (
    rows.length > 0 &&
    /specification|spec|property|attribute/i.test(rows[0][0]) &&
    /value|detail/i.test(rows[0][1])
  ) {
    rows.shift();
  }
  const rest = htmlToPlainText(html.replace(tableHtml, " "));
  return { rows, rest };
}

function cleanCell(html: string): string {
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&rsquo;": "'",
    "&mdash;": "-",
    "&ndash;": "-",
  };
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => entities[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}
