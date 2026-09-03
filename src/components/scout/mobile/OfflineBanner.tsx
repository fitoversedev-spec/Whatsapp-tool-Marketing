import { formatAgo } from "./format";
import styles from "./OfflineBanner.module.css";

export interface OfflineBannerProps {
  /** When the service worker cached what is on screen. */
  cachedAt: Date;
  /** What the reader is looking at ("these scan results", "this competitor"). */
  subject?: string;
}

/**
 * "Offline — last updated X."
 *
 * This is the single most important component in the offline story, and the
 * reason is worth stating plainly: **stale competitor data presented as current
 * is worse than an error.** A salesperson quoting "six turfs within 2 km" to a
 * land owner needs to know whether that was counted this morning or last
 * Tuesday, because in between someone may have opened a seventh.
 *
 * So the banner names the age in words, not a timestamp somebody has to
 * subtract, and every screen that can show cached data shows it above the data
 * rather than below.
 */
export function OfflineBanner({ cachedAt, subject = "this page" }: OfflineBannerProps) {
  return (
    <div className={styles.banner} role="status">
      <svg
        className={styles.icon}
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1 1l22 22" />
        <path d="M16.7 11.7A9 9 0 0 0 12 10M5 12.5a12 12 0 0 1 3-2.1M2 8.8a17 17 0 0 1 5-2.9M11 6a17 17 0 0 1 11 2.8" />
        <path d="M8.5 16a5 5 0 0 1 7 0" />
        <path d="M12 20h.01" />
      </svg>
      <span className={styles.text}>
        <span className={styles.title}>Offline — showing a saved copy</span>
        <span className={styles.detail}>
          {`${subject.charAt(0).toUpperCase()}${subject.slice(1)} was last updated ${formatAgo(cachedAt)}. `}
          It is read-only until you are back on the network, and the numbers may have moved since.
        </span>
      </span>
    </div>
  );
}
