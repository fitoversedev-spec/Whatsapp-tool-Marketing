import Link from "next/link";
import { FieldHeader } from "@/components/scout/mobile";

export const metadata = { title: "Offline — Site Scout" };

/**
 * The screen a Field-mode navigation lands on when the phone has no network
 * **and** that particular screen was never saved.
 *
 * Precached at service-worker install, which is why it must stay static and
 * tiny — no data, no fetch, nothing that could fail in the condition it exists
 * to handle.
 *
 * It names what still works rather than apologising. A surveyor standing in a
 * basement needs to know that "My sites" and any scan they have already opened
 * are still readable, and that nothing they type will be silently sent later.
 */
export default function OfflineScreen() {
  return (
    <div className="mScreen">
      <FieldHeader
        statusLeft="Offline"
        statusRight="No network"
        variant="brand"
        activeKey=""
      />

      <div className="mScroll flex-1 flex flex-col justify-center gap-4 px-[var(--m-pad-x)] pt-8 pb-[calc(32px+var(--m-safe-bottom))] text-center">
        <svg
          className="self-center text-[color:var(--plot-amber)]"
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1 1l22 22" />
          <path d="M16.7 11.7A9 9 0 0 0 12 10M5 12.5a12 12 0 0 1 3-2.1M2 8.8a17 17 0 0 1 5-2.9M11 6a17 17 0 0 1 11 2.8" />
          <path d="M8.5 16a5 5 0 0 1 7 0" />
          <path d="M12 20h.01" />
        </svg>

        <h1 className="m-0 font-display text-lg font-bold tracking-[0.08em] uppercase text-[color:var(--ink)]">No signal</h1>
        <p className="m-0 text-[length:var(--text-13-5)] leading-[1.65] text-[color:var(--m-muted)]">
          This screen has not been saved to the phone, so there is nothing to show yet. Move to
          better signal and it will load.
        </p>

        <ul className="m-0 p-0 list-none flex flex-col gap-2 text-left">
          <li>
            <Link className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-12)] py-3 px-[13px] text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--ink)] no-underline block min-h-[var(--m-touch)]" href="/scout/m/sites">
              <strong>My sites</strong> — any scan you have opened before is readable, clearly
              marked with when it was last updated.
            </Link>
          </li>
          <li>
            <span className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-12)] py-3 px-[13px] text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--ink)] no-underline block min-h-[var(--m-touch)]">
              <strong>Nothing is queued.</strong> Site Scout never holds a saved observation to send
              later — anything you record while offline will tell you it did not save, so you know
              to enter it again rather than assume it landed.
            </span>
          </li>
          <li>
            <span className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-12)] py-3 px-[13px] text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--ink)] no-underline block min-h-[var(--m-touch)]">
              <strong>A paused scan is safe.</strong> Scans run on the server as background jobs, so
              one that stopped at tile 6 of 8 resumes from tile 6 when you are back on the network —
              it does not start over.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
