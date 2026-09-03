"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Button, Tag } from "@/components/scout/ui";
import { SectionLabel, StateBlock } from "@/components/scout/patterns";
import { formatRadius } from "@/lib/scout/display/format";
import { POPULATION_LIMITATION_TEXT } from "@/lib/scout/census/disclosure";
import type { ComparisonModel } from "@/lib/scout/compare/model";
import styles from "./Compare.module.css";

export interface CompareClientProps {
  comparison: ComparisonModel;
  options: Array<{ id: string; areaLabel: string; radiusM: number }>;
  selectedIds: string[];
}

/** How many columns the table can hold before it stops being readable. */
const MAX_COLUMNS = 4;

interface ComparisonReportRow {
  id: string;
  status: string;
  error: string | null;
  link: { url: string; expiresOnLabel: string } | null;
}

/**
 * D4 — the comparison.
 *
 * The chip row writes the selection into the URL, so a comparison is a link
 * somebody can send. The table itself is rendered from `buildComparison`, which
 * decides the winning cell per row and generates the "Read" paragraph from the
 * same numbers — the mockup's fixed sentence would be wrong the first time a
 * scan changed underneath it.
 *
 * The warnings above the table are the part that matters most. A 5 km scan
 * finds more of everything than a 2 km one; a column that never searched for
 * pickleball shows a dash rather than a zero; and a desk-only score is rescaled
 * to 100 without the surveyor component, so it can out-rank a surveyed site.
 * All three are silent failures without a banner.
 */
export function CompareClient({ comparison, options, selectedIds }: CompareClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [report, setReport] = useState<ComparisonReportRow | null>(null);
  const [building, setBuilding] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  /**
   * Produce the comparison as a document.
   *
   * Same background-render shape as a single-scan report: 202, then poll. The
   * warnings above the table travel into the PDF unchanged and are printed
   * *before* it — a caveat under a table is met after the reader has already
   * drawn their conclusion.
   */
  const buildReport = useCallback(async () => {
    setBuilding(true);
    setReportError(null);
    try {
      const ids = comparison.subjects.map((s) => s.scanId);
      const res = await fetch("/api/scout/compare/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanIds: ids }),
      });
      const json = (await res.json()) as { report?: ComparisonReportRow; error?: string };
      if (!res.ok || !json.report) {
        setReportError(json.error ?? "The comparison report could not be started.");
        return;
      }
      setReport(json.report);

      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const poll = await fetch(`/api/scout/compare/report?ids=${ids.join(",")}`);
        if (!poll.ok) continue;
        const state = (await poll.json()) as { report?: ComparisonReportRow | null };
        if (!state.report) continue;
        setReport(state.report);
        if (state.report.status !== "generating") {
          if (state.report.status === "failed") setReportError(state.report.error);
          break;
        }
      }
    } catch {
      setReportError("The comparison report request failed.");
    } finally {
      setBuilding(false);
    }
  }, [comparison.subjects]);

  function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id].slice(-MAX_COLUMNS);
    startTransition(() => {
      router.push(next.length > 0 ? `/scout/compare?ids=${next.join(",")}` : "/scout/compare");
    });
  }

  const columns = comparison.subjects.length;
  const gridTemplate = `1.4fr repeat(${Math.max(columns, 1)}, 1fr)`;

  return (
    <div className={`${styles.screen} ss-scroll ssIn`}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Compare areas</h1>
          <div className={styles.lede}>
            {columns === 0
              ? "Pick two or three saved scans."
              : `${columns} scan${columns === 1 ? "" : "s"} side by side. Best value in each row is highlighted.`}
          </div>
        </div>
        <div className={styles.chips}>
          {options.map((option) => (
            <Tag
              key={option.id}
              selected={selectedIds.includes(option.id)}
              onClick={() => toggle(option.id)}
              disabled={pending}
            >
              {option.areaLabel}
            </Tag>
          ))}
        </div>
      </div>

      {options.length === 0 ? (
        <StateBlock
          eyebrow="Nothing to compare"
          title="No completed scans yet"
          body="A comparison needs at least two scans that have finished running. Run one and come back."
          action={
            <Link href="/scout/scan">
              <Button>New scan</Button>
            </Link>
          }
        />
      ) : columns === 0 ? (
        <StateBlock
          eyebrow="Pick some areas"
          title="Choose two or three scans"
          body="Use the chips above. The comparison writes itself into the address bar, so you can send the exact view to somebody else."
        />
      ) : (
        <>
          {comparison.warnings.length > 0 ? (
            <div className={styles.warnings}>
              {comparison.warnings.map((warning) => (
                <div
                  key={warning.code}
                  role={warning.severity === "warning" ? "alert" : "note"}
                  className={[
                    styles.warning,
                    warning.severity === "warning" ? styles.warningWarning : styles.warningInfo,
                  ].join(" ")}
                >
                  {warning.message}
                </div>
              ))}
            </div>
          ) : null}

          <div className={styles.table}>
            <div className={styles.scroller}>
              <div className={styles.grid} style={{ gridTemplateColumns: gridTemplate }}>
                <div className={styles.headerCategory}>Category</div>
                {comparison.subjects.map((subject) => (
                  <div key={subject.scanId} className={styles.headerArea}>
                    {subject.areaLabel}
                    <span className={styles.headerRadius}>{formatRadius(subject.radiusM)}</span>
                  </div>
                ))}

                {comparison.rows.map((row, index) => (
                  <div key={row.id} style={{ display: "contents" }}>
                    <div
                      className={[styles.rowLabel, index % 2 === 1 && styles.zebra]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {row.label}
                      {row.note ? <span className={styles.rowNote}>{row.note}</span> : null}
                    </div>
                    {row.values.map((value, columnIndex) => (
                      <div
                        key={`${row.id}-${columnIndex}`}
                        className={[
                          styles.cell,
                          index % 2 === 1 && styles.zebra,
                          row.bestIndex === columnIndex && styles.cellBest,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {value.display}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.foot}>
            <div className={styles.read}>
              <SectionLabel weight={700}>Read</SectionLabel>
              <div className={styles.readBody}>
                {comparison.narrative.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <p className={styles.method}>{POPULATION_LIMITATION_TEXT}</p>
            </div>
            {comparison.subjects.length >= 2 ? (
              <div className={styles.reportActions}>
                <Button onClick={() => void buildReport()} disabled={building}>
                  {building ? "Producing the comparison…" : "Build comparison report"}
                </Button>
                {report?.link ? (
                  <a
                    className={styles.method}
                    href={report.link.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the comparison PDF — the link works until{" "}
                    {report.link.expiresOnLabel}
                  </a>
                ) : null}
                {reportError ? <p className={styles.method}>{reportError}</p> : null}
              </div>
            ) : comparison.subjects[0] ? (
              <Link href={`/scout/report/${comparison.subjects[0].scanId}`}>
                <Button>Open the single-scan report</Button>
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
