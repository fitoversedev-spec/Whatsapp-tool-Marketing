import { DESK_ONLY_SHORT, verdictLabel, verdictTone } from "@/lib/scout/display/format";
import { Badge } from "@/components/scout/ui";
import styles from "./ScoreBadge.module.css";

export interface ScoreBadgeProps {
  total: number | null;
  verdict: "proceed" | "investigate" | "avoid" | null;
  basis: "full" | "desk_only" | null;
  confidence?: "high" | "medium" | "low" | null;
  /** Compact form for a table cell; the default suits a dashboard card. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * The score as it appears away from its breakdown — a dashboard card, a
 * comparison column, a list row.
 *
 * It carries the verdict tone and, when the score is `desk_only`, an explicit
 * "Desk only" chip. That chip is not decoration: a desk-only score is rescaled
 * to 100 without the site-practicals component, so an unsurveyed site can rank
 * above a surveyed one. The dashboard sorts by score, which is exactly where
 * that happens, so the label travels with the number everywhere the number
 * goes.
 */
export function ScoreBadge({
  total,
  verdict,
  basis,
  confidence,
  size = "md",
  className,
}: ScoreBadgeProps) {
  if (total === null || verdict === null) {
    return (
      <span className={[styles.wrap, styles[size], className].filter(Boolean).join(" ")}>
        <span className={styles.unscored}>Not scored</span>
      </span>
    );
  }

  return (
    <span className={[styles.wrap, styles[size], className].filter(Boolean).join(" ")}>
      <span className={styles.number}>{Math.round(total)}</span>
      <Badge tone={verdictTone(verdict)}>{verdictLabel(verdict)}</Badge>
      {basis === "desk_only" ? (
        <span
          className={styles.deskOnly}
          title="No site survey recorded. The site-practicals component was excluded and the remaining 85 points rescaled to 100, so this score is not comparable with a surveyed site's."
        >
          {DESK_ONLY_SHORT}
        </span>
      ) : null}
      {confidence ? <span className={styles.confidence}>{confidence} conf.</span> : null}
    </span>
  );
}
