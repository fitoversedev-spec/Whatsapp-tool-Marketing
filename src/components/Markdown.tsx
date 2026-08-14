import { type ReactNode } from "react";

// Minimal, dependency-free Markdown renderer for AI narratives. Handles the
// subset the assistant emits: ATX headings, GFM tables, bullet/numbered lists,
// **bold**, `inline code`, and paragraphs. NOT a full CommonMark implementation.

// Inline: split a line into **bold** / *emphasis* / `code` runs and render each
// piece. Order matters — the double-star alternative comes first so `**x**` is
// consumed as bold, never as an empty `*` + `*x*`. The single-star arms require
// a non-space, non-star char right after the opener AND a real closing star, so
// a lone stray "*" (e.g. "5 * 3", or an unterminated marker) is left untouched
// and rendered as plain text rather than leaking as broken formatting. Only the
// asterisk family is treated as a marker — underscores are left alone so
// snake_case identifiers (tool/field names) never turn into emphasis.
const INLINE_RE = /(\*\*[^*]+?\*\*|\*(?!\s)[^*]*?[^*\s]\*|\*(?!\s)[^*\s]\*|`[^`]+`)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE_RE);
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-slate-900">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={`${keyBase}-c${i}`} className="px-1 py-0.5 rounded bg-slate-100 text-[0.85em]">
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      // single *emphasis*
      out.push(
        <em key={`${keyBase}-e${i}`} className="italic">
          {tok.slice(1, -1)}
        </em>
      );
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => /^[\s|:-]+$/.test(l.trim()) && l.includes("-") && l.includes("|");

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls =
        level <= 1
          ? "text-base font-semibold text-slate-900"
          : level === 2
            ? "text-sm font-semibold text-slate-900"
            : "text-xs font-semibold uppercase tracking-wide text-slate-500";
      blocks.push(
        <div key={key++} className={cls}>
          {inline(h[2], `h${key}`)}
        </div>
      );
      i += 1;
      continue;
    }

    // GFM table: a header row followed by a separator row
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                {header.map((c, j) => (
                  <th
                    key={j}
                    className="text-left px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap"
                  >
                    {inline(c, `th${key}-${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-slate-100 last:border-0">
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className={`px-2 py-1.5 align-top ${ci === 0 ? "font-medium text-slate-900" : "text-slate-700"}`}
                    >
                      {inline(c, `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-5 space-y-1 text-sm text-slate-700">
          {items.map((it, j) => (
            <li key={j}>{inline(it, `ul${key}-${j}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={key++} className="list-decimal pl-5 space-y-1 text-sm text-slate-700">
          {items.map((it, j) => (
            <li key={j}>{inline(it, `ol${key}-${j}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph: gather consecutive plain lines
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={key++} className="text-sm text-slate-700 leading-relaxed">
        {inline(para.join(" "), `p${key}`)}
      </p>
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}
