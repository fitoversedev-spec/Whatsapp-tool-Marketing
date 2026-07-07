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

// Parse a single <table>...</table> block into [col1, col2] row pairs,
// dropping a leading "Specification | Value" header row.
function parseTableRows(tableHtml: string): Array<[string, string]> {
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
  if (
    rows.length > 0 &&
    /specification|spec|property|attribute/i.test(rows[0][0]) &&
    /value|detail/i.test(rows[0][1])
  ) {
    rows.shift();
  }
  return rows;
}

// Extract ALL HTML <table>s from a description, each titled by the
// nearest preceding heading (Product Information / Yarn / Backing / …),
// plus the leftover prose with every table + its heading removed.
// Catalogue descriptions are a stack of two-column spec tables; the PDF
// renders each as a real titled table instead of flattening them into
// the misaligned text tiptap's <p>-in-cell markup would otherwise give.
export function extractHtmlTables(html: string): {
  tables: Array<{ title: string; rows: Array<[string, string]> }>;
  rest: string;
} {
  if (!html) return { tables: [], rest: "" };
  const tables: Array<{ title: string; rows: Array<[string, string]> }> = [];
  let working = html;
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRegex.exec(html)) !== null) {
    const tableHtml = m[0];
    const rows = parseTableRows(tableHtml);
    if (rows.length === 0) continue;
    // Title = text of the nearest heading before this table.
    const before = html.slice(0, m.index);
    const headings = [...before.matchAll(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi)];
    const lastH = headings.length ? headings[headings.length - 1][0] : null;
    const title = lastH ? cleanCell(lastH) : "";
    tables.push({ title, rows });
    working = working.replace(tableHtml, " ");
    if (lastH) working = working.replace(lastH, " ");
  }
  return { tables, rest: htmlToPlainText(working) };
}

// Back-compat single-table helper (first table only).
export function extractHtmlTable(html: string): {
  rows: Array<[string, string]>;
  rest: string;
} {
  const { tables, rest } = extractHtmlTables(html);
  return { rows: tables[0]?.rows ?? [], rest };
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
