"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatFullDate } from "@/lib/scout/display/format";
import type { ReportListRow } from "@/lib/scout/reports/repository";

import { EditableReportTitle } from "./EditableReportTitle";

function statusBadge(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    draft: { label: "Draft", color: "bg-slate-100 text-slate-600" },
    generating: { label: "Generating", color: "bg-amber-100 text-amber-700" },
    generated: { label: "Generated", color: "bg-emerald-100 text-emerald-700" },
    delivered: { label: "Sent", color: "bg-blue-100 text-blue-700" },
    failed: { label: "Failed", color: "bg-red-100 text-red-700" },
  };
  const s = map[status] ?? { label: status, color: "bg-slate-100 text-slate-600" };
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${s.color}`}>
      {s.label}
    </span>
  );
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Resend" once a report has gone out, "Send" once it is ready but has not, else nothing. */
function sendLabel(status: string): "Send" | "Resend" | null {
  if (status === "delivered") return "Resend";
  if (status === "generated") return "Send";
  return null;
}

/**
 * Digits from a recorded recipient, kept only when they plausibly are a
 * phone number rather than a name.
 *
 * `sentTo` is a free-text recipient *name* ("Sent to Deepa") — see
 * `share.ts` — not a validated phone field, so a name yields no digits here
 * and the wa.me link opens WhatsApp's own contact picker instead of
 * guessing wrong in front of a customer.
 */
function phoneDigits(sentTo: string | null): string {
  const digits = (sentTo ?? "").replace(/[^0-9]/g, "");
  return digits.length >= 7 ? digits : "";
}

export interface ReportListEntryProps {
  report: ReportListRow;
}

/**
 * One row of `/scout/reports`.
 *
 * Named `ReportListEntry` rather than `ReportRow` on purpose — `repository.ts`
 * already exports a `ReportRow` type (a raw generation row) and a
 * `ReportListRow` interface (this row's own data shape); a third, similarly
 * named thing in the same domain is how someone ends up aliasing an import at
 * 2am.
 *
 * The row is still a single `<Link>` to the studio, same as before it grew
 * an editable title — {@link EditableReportTitle} guards its own clicks with
 * `preventDefault`/`stopPropagation` so renaming in place never navigates
 * the row away mid-edit.
 */
export function ReportListEntry({ report }: ReportListEntryProps) {
  const router = useRouter();
  const [title, setTitle] = useState(report.title);
  const [archiving, setArchiving] = useState(false);

  /**
   * Opens WhatsApp Web with the report's signed link already in the message.
   *
   * No share is recorded here — that is the studio's "Share on WhatsApp"
   * flow (`ReportStudio.tsx`), which asks for a recipient name and logs the
   * hand-over. This is the quick, list-page shortcut the task asked for: a
   * pre-filled `wa.me` link and nothing else.
   */
  function handleSend(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!report.reportUrl) return;
    const message = `Here is your Site Scout report for ${report.areaLabel}: ${report.reportUrl}`;
    const phone = phoneDigits(report.sentTo);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  async function handleArchive(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (archiving) return;
    if (!window.confirm("Delete this report from the list? Any link already sent keeps working.")) {
      return;
    }
    setArchiving(true);
    try {
      const res = await fetch(`/api/scout/reports/${report.id}/archive`, { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        setArchiving(false);
      }
    } catch {
      setArchiving(false);
    }
  }

  const send = sendLabel(report.status);

  return (
    <Link
      href={`/scout/report/${report.scanId}`}
      className="flex items-center gap-4 py-[15px] px-5 border-t border-slate-200 no-underline text-slate-900 font-sans first:border-t-0 hover:bg-slate-100 transition-colors"
    >
      <span className="flex-none w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14,2 14,8 20,8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </span>

      <span className="flex-1 min-w-0">
        <EditableReportTitle
          reportId={report.id}
          title={title ?? ""}
          placeholder={`Report v${report.version}`}
          onSaved={setTitle}
          className="group flex items-center gap-1.5 min-w-0 max-w-full text-left bg-transparent border-0 p-0 cursor-text text-sm font-semibold"
          inputClassName="w-full box-border font-sans text-sm font-semibold text-slate-900 border border-slate-300 rounded-md px-2 py-1 outline-none focus:border-court-500 focus:ring-2 focus:ring-court-500/20"
        />
        <span className="block text-xs text-slate-500 mt-1 truncate">
          {report.areaLabel} · v{report.version}
          {report.sentTo ? ` · Sent to ${report.sentTo}` : ""}
          {report.ownerName ? ` · by ${report.ownerName}` : ""}
        </span>
      </span>

      <span className="flex-none text-right">
        <span className="block text-xs text-slate-500">
          {report.generatedAt ? formatFullDate(new Date(report.generatedAt)) : formatFullDate(new Date(report.createdAt))}
        </span>
        <span className="block mt-1">{formatBytes(report.pdfBytes)}</span>
      </span>

      <span className="flex-none">{statusBadge(report.status)}</span>

      <span className="flex-none flex items-center gap-1.5">
        {send && report.reportUrl ? (
          <button
            type="button"
            onClick={handleSend}
            className="inline-flex items-center rounded-md bg-wa-green/10 px-2.5 py-1 text-xs font-semibold text-wa-green hover:bg-wa-green/20 transition-colors"
          >
            {send}
          </button>
        ) : null}

        <button
          type="button"
          onClick={handleArchive}
          disabled={archiving}
          aria-label="Delete report"
          title="Delete report"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </span>
    </Link>
  );
}
