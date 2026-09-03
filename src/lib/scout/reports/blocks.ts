/**
 * The report's composable blocks — the D5 "Include" checkboxes.
 *
 * Defined once, here, because three things read them: the studio's checkbox
 * list, the live paper preview, and Phase 6's PDF renderer. Ids are persisted
 * in `reports.included_blocks`, so **renaming one silently drops that block
 * from every report already composed** — change a `label`, never an `id`.
 *
 * Two blocks are `alwaysOn`. The area header is the document's identity, and
 * the limitations block is the paragraph that stops a reader inferring a
 * catchment population from a saturation figure. Neither is a composition
 * choice, so neither gets a checkbox.
 */

export interface ReportBlockDef {
  readonly id: string;
  readonly label: string;
  /** One line explaining what the block puts on the page. */
  readonly help: string;
  /** Rendered whether or not the surveyor asks for it. */
  readonly alwaysOn?: boolean;
  readonly defaultOn: boolean;
}

export const REPORT_BLOCKS: readonly ReportBlockDef[] = [
  {
    id: "header",
    label: "Area header",
    help: "The area, the radius and the date the data was collected.",
    alwaysOn: true,
    defaultOn: true,
  },
  {
    id: "stat-cards",
    label: "Stat cards",
    help: "Facilities, reviews, average rating and demand places.",
    defaultOn: true,
  },
  {
    id: "score",
    label: "Site score and breakdown",
    help: "The score, the verdict and all five components. The score is never printed without them.",
    defaultOn: true,
  },
  {
    id: "saturation",
    label: "Competitive saturation",
    help: "Facilities per weighted demand anchor, against the city benchmark and its sample count.",
    defaultOn: true,
  },
  {
    id: "count-table",
    label: "Count table",
    help: "Per-category counts, review totals and the nearest example.",
    defaultOn: true,
  },
  {
    id: "map",
    label: "Map with markers",
    help: "The catchment with competing facilities and demand anchors plotted.",
    defaultOn: true,
  },
  {
    id: "sweep",
    label: "Spaces sweep",
    help: "Vacant plots and terraces marked on the satellite sweep, with their notes.",
    defaultOn: false,
  },
  {
    id: "field-notes",
    label: "Field notes",
    help: "What the surveyor saw that the data cannot show.",
    defaultOn: true,
  },
  {
    id: "limitations",
    label: "Limitations",
    help: "What this assessment does not cover. Printed on any document carrying a saturation figure.",
    alwaysOn: true,
    defaultOn: true,
  },
] as const;

export const REPORT_BLOCK_IDS: readonly string[] = REPORT_BLOCKS.map((b) => b.id);

/** Blocks the surveyor can actually toggle. */
export const TOGGLEABLE_REPORT_BLOCKS = REPORT_BLOCKS.filter((b) => !b.alwaysOn);

export type ReportBlockState = Readonly<Record<string, boolean>>;

export function defaultBlockState(): ReportBlockState {
  return Object.fromEntries(REPORT_BLOCKS.map((b) => [b.id, b.defaultOn]));
}

/**
 * Normalise a stored or submitted block state.
 *
 * Unknown ids are dropped rather than kept: an id that no longer exists cannot
 * be rendered, and keeping it would let a stale key look like a live setting.
 * `alwaysOn` blocks are forced on whatever arrives, so a client that sends
 * `limitations: false` does not produce a document with a saturation figure and
 * no caveat.
 */
export function sanitiseBlockState(raw: unknown): ReportBlockState {
  const defaults = defaultBlockState();
  if (!raw || typeof raw !== "object") return defaults;
  const input = raw as Record<string, unknown>;
  const out: Record<string, boolean> = { ...defaults };
  for (const block of REPORT_BLOCKS) {
    if (block.alwaysOn) {
      out[block.id] = true;
      continue;
    }
    const value = input[block.id];
    if (typeof value === "boolean") out[block.id] = value;
  }
  return out;
}
