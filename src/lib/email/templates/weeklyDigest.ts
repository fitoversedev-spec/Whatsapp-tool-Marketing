// Phase 5 (analytics v2) — the weekly-digest email body. PURE render: takes a
// DigestData (already composed once by digest.ts, reused by both the in-app
// Digest tab and this email) and returns { subject, html, text }. It does NOT
// call sendEmail — the cron job (digestJob.ts) owns transport; this file owns
// presentation only, so it stays trivially testable and can't accidentally
// fire a send.
//
// EMAIL-CLIENT CONSTRAINTS (why this looks the way it does):
//   - Inline styles only. Gmail/Outlook/Apple Mail strip <style> blocks and
//     external CSS, so every rule lives on a `style=""` attribute. No Tailwind
//     classes, no <link>, no external assets/images (also dodges the "images
//     blocked by default" first-render).
//   - Table-free flow layout is fine here (single column), but colours and
//     spacing are all explicit hex/px — no CSS variables (also stripped).
//   - Fitoverse brand green (#159341) for the header bar + accents, per the
//     brand guidelines.
import type { DigestData, DigestInsight } from "@/lib/analytics/digest";

const BRAND_GREEN = "#159341";
const WARNING_AMBER = "#c25e00"; // readable amber for a "warning" pill on white; not the brand red (reserved for destructive UI).
const TEXT_DARK = "#1a1a1a";
const TEXT_MUTED = "#5b5b5b";
const BORDER = "#e4e4e4";
const CARD_BG = "#f7f9f7";

function fmtInr(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtWinRate(winRate: DigestData["winRate"]): string {
  if (winRate.rate == null) return `Pending (only ${winRate.n} closed)`;
  return `${Math.round(winRate.rate * 100)}% (${winRate.n} closed)`;
}

// Dynamic text (insight titles/details, which can carry a data-sourced lead
// source or rep name) is HTML-escaped before interpolation — an email body is
// an HTML sink, and a stray "<" in a source name shouldn't break rendering.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function severityPill(severity: DigestInsight["severity"]): string {
  const isWarning = severity === "warning";
  const bg = isWarning ? WARNING_AMBER : BRAND_GREEN;
  const label = isWarning ? "Warning" : "Info";
  return `<span style="display:inline-block;background:${bg};color:#ffffff;font-size:11px;font-weight:600;line-height:1;padding:4px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:0.4px;">${label}</span>`;
}

function insightBlock(insight: DigestInsight): string {
  return `
    <div style="border:1px solid ${BORDER};border-radius:8px;padding:16px;margin:0 0 12px 0;background:${CARD_BG};">
      <div style="margin:0 0 8px 0;">${severityPill(insight.severity)}</div>
      <div style="font-size:15px;font-weight:600;color:${TEXT_DARK};margin:0 0 6px 0;">${esc(insight.title)}</div>
      <div style="font-size:13px;color:${TEXT_MUTED};line-height:1.5;margin:0 0 10px 0;">${esc(insight.detail)}</div>
      <div style="font-size:13px;color:${TEXT_DARK};line-height:1.5;border-left:3px solid ${BRAND_GREEN};padding-left:10px;">
        <strong style="color:${BRAND_GREEN};">Recommended:</strong> ${esc(insight.recommendedAction)}
      </div>
    </div>`;
}

function kpiRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:${TEXT_MUTED};border-bottom:1px solid ${BORDER};">${esc(label)}</td>
      <td style="padding:8px 12px;font-size:14px;font-weight:600;color:${TEXT_DARK};border-bottom:1px solid ${BORDER};text-align:right;">${esc(value)}</td>
    </tr>`;
}

export function renderWeeklyDigestEmail(digest: DigestData): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Fitoverse weekly digest — ${digest.periodLabel}`;

  const insightsHtml = digest.topInsights.length
    ? digest.topInsights.map(insightBlock).join("")
    : `<div style="font-size:13px;color:${TEXT_MUTED};padding:12px 0;">No notable signals this week.</div>`;

  const paceRow =
    digest.targetPaceLine != null ? kpiRow("Target pace", digest.targetPaceLine) : "";

  const html = `<div style="margin:0;padding:0;background:#eeeeee;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
    <div style="background:${BRAND_GREEN};padding:24px 28px;">
      <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.3px;">Fitoverse — Weekly Digest</div>
      <div style="color:#d6f0e0;font-size:13px;margin-top:4px;">${esc(digest.periodLabel)}</div>
    </div>

    <div style="padding:24px 28px;">
      <div style="font-size:15px;line-height:1.55;color:${TEXT_DARK};margin:0 0 20px 0;">${esc(digest.headline)}</div>

      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${BRAND_GREEN};margin:0 0 8px 0;">This week</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;overflow:hidden;margin:0 0 24px 0;">
        ${kpiRow("Won revenue", fmtInr(digest.wonRevenue))}
        ${kpiRow("Win rate", fmtWinRate(digest.winRate))}
        ${paceRow}
      </table>

      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${BRAND_GREEN};margin:0 0 12px 0;">Top signals</div>
      ${insightsHtml}
    </div>

    <div style="padding:16px 28px;border-top:1px solid ${BORDER};background:${CARD_BG};">
      <div style="font-size:11px;color:${TEXT_MUTED};line-height:1.5;">
        Generated automatically by Fitoverse CRM Analytics. Open the Insights &amp; Digest tab for the full feed and to drill into the deals behind each signal.
      </div>
    </div>
  </div>
</div>`;

  const text = renderText(digest);

  return { subject, html, text };
}

// Plain-text fallback for clients that don't render HTML (or user preference).
// Same content, no markup — a flat readable transcript of the same DigestData.
function renderText(digest: DigestData): string {
  const lines: string[] = [];
  lines.push(`FITOVERSE — WEEKLY DIGEST`);
  lines.push(digest.periodLabel);
  lines.push("");
  lines.push(digest.headline);
  lines.push("");
  lines.push("THIS WEEK");
  lines.push(`  Won revenue: ${fmtInr(digest.wonRevenue)}`);
  lines.push(`  Win rate:    ${fmtWinRate(digest.winRate)}`);
  if (digest.targetPaceLine != null) lines.push(`  Target pace: ${digest.targetPaceLine}`);
  lines.push("");
  lines.push("TOP SIGNALS");
  if (digest.topInsights.length === 0) {
    lines.push("  No notable signals this week.");
  } else {
    for (const insight of digest.topInsights) {
      lines.push(`  [${insight.severity.toUpperCase()}] ${insight.title}`);
      lines.push(`    ${insight.detail}`);
      lines.push(`    Recommended: ${insight.recommendedAction}`);
      lines.push("");
    }
  }
  lines.push("Generated automatically by Fitoverse CRM Analytics.");
  return lines.join("\n");
}
