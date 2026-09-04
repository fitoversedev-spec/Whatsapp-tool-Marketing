"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  FieldHeader,
  OfflineBanner,
  Sheet,
  StickyFooter,
  apiFetch,
  ApiError,
  formatDistance,
  formatMinuteOfDay,
  formatNumber,
  formatRating,
  useOnline,
} from "@/components/scout/mobile";
import { SectionLabel } from "@/components/scout/patterns";
import { Badge, Button } from "@/components/scout/ui";
import { payAndPlayLabel, type VenueFieldDef } from "@/lib/scout/venueSurvey";

interface OperatingWindow {
  earliestOpenMinute?: number | null;
  latestCloseMinute?: number | null;
  opensEarly?: boolean;
  closesLate?: boolean;
  openSunday?: boolean;
  openDays?: number[];
  alwaysOpen?: boolean;
}

interface PlacePayload {
  observed: {
    placeId: string;
    name: string;
    location: { lat: number; lng: number };
    rating: number | null;
    reviewCount: number | null;
    address: string | null;
    priceLevel: number | null;
    website: string | null;
    phone: string | null;
    businessStatus: string | null;
    primaryTypeDisplayName: string | null;
    googleMapsUri: string | null;
    hours: { weekdayDescriptions?: string[] } | null;
    operatingWindow: OperatingWindow | null;
  };
  membership: {
    categories: string[];
    categoryLabels: string[];
    side: string;
    distanceM: number | null;
    direction: string | null;
  } | null;
  entered: Record<string, string>;
  fields: VenueFieldDef[];
  themes: {
    analysed: boolean;
    complaints: Array<{ theme: string; label: string; mentionCount: number; quotes: string[] }>;
  };
}

/**
 * Screen 03 — Competitor detail.
 *
 * ## The distinction this whole screen is built around
 *
 * **Observed** data came from Google: the rating, the review count, the opening
 * hours, the price level, the website, the phone number. **Entered** data came
 * from a person standing at the gate: the flooring, the setting, the court
 * count and the hourly rate.
 *
 * The mockup prints `Pay and play · ₹1,200/hr` in the same table as the star
 * rating, as though both were facts of the same kind. They are not, and Google
 * supplies no hourly rate for any venue — so either that row is invented, or
 * somebody types it. This screen is where they type it, and it says which half
 * of the table is which, because a salesperson quoting a competitor's price to
 * a land owner should know whether it came from a board on a gate or from a
 * colleague's memory three weeks ago.
 *
 * ## Two additions the mockup does not have
 *
 * **Opening hours and the derived operating window.** A competitor holding the
 * 7–11 pm slot is a different competitor from one that closes at 8; Phase 1
 * already derives exactly that and it was not being shown anywhere.
 *
 * **Top complaint themes.** A salesperson standing outside a rival benefits
 * enormously from knowing its customers complain about parking — it is the
 * sentence that turns "there is competition here" into "here is what they are
 * getting wrong". The quotes are verbatim and verified: Phase 3 discards any
 * quote that is not a literal substring of the reviews it claims to come from.
 */
export function PlaceScreen({ placeId, scanId }: { placeId: string; scanId: string | null }) {
  const router = useRouter();
  const online = useOnline();

  const [data, setData] = useState<PlacePayload | null>(null);
  const [staleAt, setStaleAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<VenueFieldDef | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  const url = `/api/scout/places/${encodeURIComponent(placeId)}${scanId ? `?scan=${scanId}` : ""}`;

  const load = useCallback(async () => {
    try {
      const { data: payload, staleAt: cachedAt } = await apiFetch<PlacePayload>(url);
      setData(payload);
      setStaleAt(cachedAt);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this competitor.");
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Saved immediately, and reported immediately.
   *
   * Nothing is queued for later. A write that fires from a pocket twenty
   * minutes on would let a surveyor believe an observation landed when it did
   * not — and worse, could land *after* they corrected it. So the save either
   * succeeds now or says plainly that it did not.
   */
  async function save(fieldId: string, value: string) {
    if (!data) return;
    const previous = data.entered;
    const optimistic = { ...previous };
    if (value === "") delete optimistic[fieldId];
    else optimistic[fieldId] = value;
    setData({ ...data, entered: optimistic });
    setEditing(null);
    setStatus("Saving…");
    setStatusIsError(false);

    try {
      const { data: saved } = await apiFetch<{ entered: Record<string, string>; rejected: string[] }>(
        `/api/scout/places/${encodeURIComponent(placeId)}`,
        { method: "PUT", body: { values: { [fieldId]: value } }, timeoutMs: 20_000 },
      );
      setData((current) => (current ? { ...current, entered: saved.entered } : current));
      setStatus(
        saved.rejected.length > 0
          ? `Saved, but ${saved.rejected.join(", ")} was not accepted.`
          : "Saved.",
      );
      setStatusIsError(saved.rejected.length > 0);
    } catch (e) {
      setData((current) => (current ? { ...current, entered: previous } : current));
      setStatus(
        e instanceof ApiError
          ? `Not saved — ${e.message} Nothing was queued; enter it again when you have signal.`
          : "Not saved. Nothing was queued; enter it again when you have signal.",
      );
      setStatusIsError(true);
    }
  }

  const observed = data?.observed;
  const membership = data?.membership;
  const entered = data?.entered ?? {};

  const mapsHref =
    observed?.googleMapsUri ??
    (observed
      ? `https://www.google.com/maps/search/?api=1&query=${observed.location.lat},${observed.location.lng}`
      : "https://www.google.com/maps");

  return (
    <div className="mScreen">
      <FieldHeader
        statusLeft={online ? "Field mode" : "Offline"}
        statusRight="Competitor"
        backHref={scanId ? `/scout/m/scan/${scanId}` : "/scout/m/scan"}
        backLabel="Back to results"
        title="Back to results"
        activeKey="detail"
        navContext={{ scanId, placeId }}
      />

      <div className="mScroll ss-scroll pt-5 pb-6 px-[var(--m-pad-x)] flex flex-col gap-[18px] mIn">
        {staleAt ? <OfflineBanner cachedAt={staleAt} subject="this competitor" /> : null}

        {error && !data ? (
          <p className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-12)] py-[13px] px-3.5 text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--m-muted-on-white)]" role="alert">
            {error}
          </p>
        ) : null}

        {observed ? (
          <>
            {/* ------------------------------------------ name card */}
            <section className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-18)] py-5 px-[18px] flex flex-col gap-3.5">
              <h1 className="m-0 font-sans text-[21px] font-semibold leading-[1.25] normal-case tracking-normal [text-wrap:pretty]">{observed.name}</h1>

              <div className="flex items-center gap-[9px] flex-wrap">
                {typeof observed.rating === "number" ? (
                  <>
                    <span className="flex items-center gap-[5px] text-[length:var(--text-15)] font-semibold">
                      <svg
                        className="text-court-500"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l6.9-1z" />
                      </svg>
                      {formatRating(observed.rating)}
                    </span>
                    <span className="text-[color:var(--border-strong)]">·</span>
                  </>
                ) : null}
                <span className="text-[length:var(--text-13)] text-[color:var(--m-muted-on-white)]">
                  {typeof observed.reviewCount === "number"
                    ? `${formatNumber(observed.reviewCount)} reviews on Google`
                    : "Not rated on Google"}
                </span>
              </div>

              <div className="flex flex-wrap gap-[7px]">
                {(membership?.categoryLabels ?? []).map((label) => (
                  <Badge key={label} tone="neutral">
                    {label}
                  </Badge>
                ))}
                {entered.flooring ? <Badge tone="green">{entered.flooring}</Badge> : null}
                {entered.setting ? <Badge tone="blue">{entered.setting}</Badge> : null}
              </div>

              {observed.businessStatus && observed.businessStatus !== "OPERATIONAL" ? (
                <p className="text-[length:var(--text-12-5)] text-track-600 font-semibold">
                  {`Google reports this venue as ${observed.businessStatus.replace(/_/g, " ").toLowerCase()}.`}
                </p>
              ) : null}
            </section>

            {/* -------------------------------------- distance card */}
            <section className="bg-[var(--black)] text-[color:var(--on-dark)] rounded-[var(--radius-18)] p-[18px] flex items-center justify-between gap-3.5">
              <div>
                <div className="text-[length:var(--text-10-5)] font-semibold tracking-[var(--tracking-stat)] uppercase text-[color:var(--on-dark-muted)]">From customer&rsquo;s plot</div>
                <div className="font-display text-[24px] font-bold tracking-[0.02em] mt-[7px]">
                  {formatDistance(membership?.distanceM ?? null)}
                </div>
              </div>
              <div className="text-right text-[length:var(--text-11-5)] text-[color:var(--on-dark-muted-soft)] leading-normal flex-none">
                {membership?.direction ?? "—"}
                <br />
                {/*
                 * The mockup's third line is "4 min drive". This build
                 * integrates no routing API, so a drive time here would be a
                 * number nobody measured — and this whole product is built on
                 * every figure tracing to something real. The slot carries the
                 * thing that actually gets a surveyor there instead.
                 */}
                <a className="text-[color:var(--sky)] underline" href={mapsHref} target="_blank" rel="noreferrer">
                  Directions
                </a>
              </div>
            </section>

            {/* ------------------------------------- entered fields */}
            <div>
              <SectionLabel as="h2">Recorded on site</SectionLabel>
              <p className="flex items-center gap-[7px] text-[length:var(--text-11)] text-[color:var(--m-muted)] leading-[1.45]">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
                Entered by a surveyor. Google supplies none of this — tap a row to change it.
              </p>
            </div>

            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-18)] overflow-hidden">
              {(data?.fields ?? []).map((field) => (
                <button
                  key={field.id}
                  type="button"
                  className="flex items-center justify-between gap-3 w-full py-[13px] px-4 min-h-[var(--m-touch)] text-[length:var(--text-13)] bg-[var(--surface-card)] font-sans text-left text-[color:var(--ink)] border-0 cursor-pointer"
                  onClick={() => setEditing(field)}
                >
                  <span className="text-[color:var(--m-muted-on-white)] flex-none">{field.label}</span>
                  <span
                    className={`text-right min-w-0 [overflow-wrap:anywhere] ${enteredDisplay(field, entered) ? "font-semibold" : "font-normal text-[color:var(--accent)]"}`}
                  >
                    {enteredDisplay(field, entered) ?? "Add"}
                  </span>
                  <svg
                    className="flex-none text-[color:var(--border-strong)]"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              ))}
            </div>

            {payAndPlayLabel(entered) ? (
              <p className="text-[length:var(--text-11-5)] text-[color:var(--m-muted)] leading-normal">{`Pay and play: ${payAndPlayLabel(entered)}`}</p>
            ) : null}

            {status ? (
              <p
                className={`text-[length:var(--text-11-5)] leading-normal ${statusIsError ? "text-track-600" : "text-[color:var(--m-muted)]"}`}
                role="status"
              >
                {status}
              </p>
            ) : null}

            {/* ------------------------------------ observed fields */}
            <div>
              <SectionLabel as="h2">From Google</SectionLabel>
              <p className="flex items-center gap-[7px] text-[length:var(--text-11)] text-[color:var(--m-muted)] leading-[1.45]">
                Observed data, as Google last returned it. Not editable here.
              </p>
            </div>

            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-18)] overflow-hidden">
              <div className="flex items-center justify-between gap-3 w-full py-[13px] px-4 min-h-[var(--m-touch)] text-[length:var(--text-13)] border-b border-[var(--border-default)] bg-[var(--surface-card)] font-sans text-left text-[color:var(--ink)] last:border-b-0">
                <span className="text-[color:var(--m-muted-on-white)] flex-none">Type</span>
                <span className="font-semibold text-right min-w-0 [overflow-wrap:anywhere]">{observed.primaryTypeDisplayName ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-3 w-full py-[13px] px-4 min-h-[var(--m-touch)] text-[length:var(--text-13)] border-b border-[var(--border-default)] bg-[var(--surface-card)] font-sans text-left text-[color:var(--ink)] last:border-b-0">
                <span className="text-[color:var(--m-muted-on-white)] flex-none">Price level</span>
                <span className="font-semibold text-right min-w-0 [overflow-wrap:anywhere]">{priceLevelLabel(observed.priceLevel)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 w-full py-[13px] px-4 min-h-[var(--m-touch)] text-[length:var(--text-13)] border-b border-[var(--border-default)] bg-[var(--surface-card)] font-sans text-left text-[color:var(--ink)] last:border-b-0">
                <span className="text-[color:var(--m-muted-on-white)] flex-none">Phone</span>
                <span className="font-semibold text-right min-w-0 [overflow-wrap:anywhere]">
                  {observed.phone ? <a href={`tel:${observed.phone}`}>{observed.phone}</a> : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 w-full py-[13px] px-4 min-h-[var(--m-touch)] text-[length:var(--text-13)] border-b border-[var(--border-default)] bg-[var(--surface-card)] font-sans text-left text-[color:var(--ink)] last:border-b-0">
                <span className="text-[color:var(--m-muted-on-white)] flex-none">Website</span>
                <span className="font-semibold text-right min-w-0 [overflow-wrap:anywhere]">
                  {observed.website ? (
                    <a href={observed.website} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 w-full py-[13px] px-4 min-h-[var(--m-touch)] text-[length:var(--text-13)] border-b border-[var(--border-default)] bg-[var(--surface-card)] font-sans text-left text-[color:var(--ink)] last:border-b-0">
                <span className="text-[color:var(--m-muted-on-white)] flex-none">Address</span>
                <span className="font-semibold text-right min-w-0 [overflow-wrap:anywhere]">{observed.address ?? "—"}</span>
              </div>
            </div>

            {/* ------------------------------------- opening hours */}
            <div>
              <SectionLabel as="h2">Opening hours</SectionLabel>
            </div>
            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-18)] overflow-hidden">
              <div className="py-[13px] px-4 text-[length:var(--text-12-5)] leading-[1.6] text-[color:var(--ink)]">
                {observed.hours?.weekdayDescriptions?.length ? (
                  observed.hours.weekdayDescriptions.map((line) => <div key={line}>{line}</div>)
                ) : (
                  <span className="text-[color:var(--m-muted-on-white)]">Google returned no opening hours.</span>
                )}
                <OperatingWindowNote window={observed.operatingWindow} />
              </div>
            </div>

            {/* ------------------------------- complaint themes */}
            <div>
              <SectionLabel as="h2">What reviewers complain about</SectionLabel>
            </div>
            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[var(--radius-18)] overflow-hidden">
              {!data?.themes.analysed ? (
                <p className="py-[13px] px-4 text-[length:var(--text-12-5)] leading-[1.6] text-[color:var(--ink)]">
                  <span className="text-[color:var(--m-muted-on-white)]">
                    This venue&rsquo;s reviews have not been analysed yet. That is different from
                    &ldquo;no complaints&rdquo; — nobody has looked.
                  </span>
                </p>
              ) : data.themes.complaints.length === 0 ? (
                <p className="py-[13px] px-4 text-[length:var(--text-12-5)] leading-[1.6] text-[color:var(--ink)]">
                  <span className="text-[color:var(--m-muted-on-white)]">
                    Its reviews were analysed and raised no recurring complaint.
                  </span>
                </p>
              ) : (
                data.themes.complaints.map((theme) => (
                  <div key={theme.theme} className="border-t border-[var(--border-default)] py-[13px] px-4 first:border-t-0">
                    <div className="flex items-baseline justify-between gap-2.5 text-[length:var(--text-13)] font-semibold">
                      <span>{theme.label}</span>
                      <span className="flex-none text-[length:var(--text-11-5)] font-normal text-[color:var(--m-muted-on-white)]">
                        {`${theme.mentionCount} mention${theme.mentionCount === 1 ? "" : "s"}`}
                      </span>
                    </div>
                    {theme.quotes.map((quote) => (
                      <p key={quote} className="mt-[7px] text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--m-muted-on-white)] italic">{`“${quote}”`}</p>
                    ))}
                  </div>
                ))
              )}
            </div>

            <a className="flex items-center justify-between gap-2.5 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg py-[15px] px-4 min-h-[var(--m-touch)] text-[length:var(--text-13-5)] font-semibold text-[color:var(--accent)] no-underline" href={mapsHref} target="_blank" rel="noreferrer">
              <span className="flex items-center gap-2.5">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Open in Maps
              </span>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </a>
          </>
        ) : null}
      </div>

      <StickyFooter>
        <Button
          variant="dark"
          block
          size="lg"
          onClick={() => router.push(scanId ? `/scout/m/scan/${scanId}` : "/scout/m/scan")}
        >
          Back to results
        </Button>
      </StickyFooter>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        heading={editing?.label ?? ""}
      >
        {editing ? (
          <FieldEditor
            field={editing}
            value={entered[editing.id] ?? ""}
            onSave={(value) => void save(editing.id, value)}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------- editor */

function FieldEditor({
  field,
  value,
  onSave,
  onCancel,
}: {
  field: VenueFieldDef;
  value: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <div>
      <p className="m-0 mb-3.5 text-[length:var(--text-12-5)] leading-[1.55] text-[color:var(--m-muted-on-white)]">{field.help}</p>

      {field.kind === "choice" ? (
        <div className="flex flex-col gap-2">
          {(field.options ?? []).map((option) => (
            <button
              key={option}
              type="button"
              className={`flex items-center gap-2.5 min-h-[var(--m-touch)] py-2.5 px-3 border rounded-[var(--radius-10)] font-sans text-[length:var(--text-13)] text-[color:var(--ink)] cursor-pointer text-left ${draft === option ? "border-[var(--accent)] bg-court-100 font-semibold" : "border-[var(--border-strong)] bg-[var(--surface-card)]"}`}
              onClick={() => onSave(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <input
          className="w-full min-h-[var(--m-touch)] py-3 px-[13px] border border-[var(--border-strong)] rounded-[var(--radius-12)] font-sans text-sm text-[color:var(--ink)] bg-[var(--surface-card)]"
          aria-label={field.label}
          inputMode={field.kind === "currency" ? "numeric" : "text"}
          placeholder={field.placeholder}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
        />
      )}

      <div className="flex gap-2.5 mt-4">
        {field.kind === "choice" ? null : (
          <Button block onClick={() => onSave(draft.trim())}>
            Save
          </Button>
        )}
        {value ? (
          <Button variant="secondary" block onClick={() => onSave("")}>
            Clear
          </Button>
        ) : (
          <Button variant="secondary" block onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- fragments */

function enteredDisplay(field: VenueFieldDef, entered: Record<string, string>): string | null {
  const raw = entered[field.id];
  if (!raw) return null;
  if (field.kind === "currency") return `₹${Number(raw).toLocaleString("en-IN")}/hr`;
  return raw;
}

/**
 * Phase 1 derives this at ingest and nothing was showing it.
 *
 * 7–11 pm is the highest-revenue window of the day. A competitor open until
 * 23:00 is holding it; one closing at 20:00 is not, and that difference is
 * worth more to a salesperson than the star rating.
 */
function OperatingWindowNote({ window: w }: { window: OperatingWindow | null }) {
  if (!w) return null;
  const open = formatMinuteOfDay(w.earliestOpenMinute ?? null);
  const close = formatMinuteOfDay(w.latestCloseMinute ?? null);

  return (
    <span className="inline-block mt-1.5 text-[length:var(--text-11-5)] text-court-700 font-semibold">
      {w.alwaysOpen
        ? "Open 24 hours."
        : open && close
          ? `Widest window ${open}–${close}. `
          : ""}
      {w.closesLate
        ? "Holds the 7–11 pm peak."
        : w.alwaysOpen
          ? ""
          : "Does not hold the 7–11 pm peak."}
      {w.openSunday === false ? " Closed on Sundays." : ""}
    </span>
  );
}

/** Google's 0–4 price level. `null` means "not fetched", never "free". */
function priceLevelLabel(level: number | null): string {
  if (level === null || !Number.isFinite(level)) return "—";
  return "₹".repeat(Math.max(1, Math.min(4, level)));
}
