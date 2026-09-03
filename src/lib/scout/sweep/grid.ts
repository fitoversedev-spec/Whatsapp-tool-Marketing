/**
 * The spaces sweep grid — **pure**. No DOM, no Leaflet, no database.
 *
 * Ported from v16 (`legacy/fitoverse-site-scout-v16.html`, "5. grid"), which
 * got the important part right: the grid is sized in **metres on the ground**,
 * not in screen pixels or in a fixed number of columns. A surveyor sweeping a
 * locality in satellite view needs to know that cell C3 is 500 m across, and
 * they need the same cell to still be C3 after they pan away and come back.
 *
 * What is kept from v16:
 *
 * - real-metric cell sizing, with the longitude degree scaled by `cos(lat)`
 * - `A1` at the top-left, columns lettered left-to-right, rows numbered down
 * - click cycles `none → plot → terrace → rejected → none`
 * - double-click splits one cell into four quadrants, suffixed `a`–`d`
 * - per-cell notes, CSV export, satellite and Street View deep links
 *
 * What is deliberately changed: v16 wrote the sweep to `localStorage` under a
 * key derived from a typed area name. That lost a morning's fieldwork to a
 * cleared browser and hid it from everyone else on the team. Here the document
 * this module produces is persisted on `scans.sweep`.
 */

/** What a surveyor can say about a cell. `none` is "not swept", not "empty". */
export type SweepCellStatus = "none" | "plot" | "terrace" | "rejected";

/** Click order. `none` is in the list so a fourth click clears a mistake. */
export const SWEEP_CYCLE: readonly SweepCellStatus[] = [
  "none",
  "plot",
  "terrace",
  "rejected",
] as const;

export interface SweepCellStatusDef {
  readonly id: SweepCellStatus;
  readonly label: string;
  /** Placeholder for the note field — what to write down for this kind of find. */
  readonly notePlaceholder: string;
}

export const SWEEP_STATUSES: readonly SweepCellStatusDef[] = [
  {
    id: "none",
    label: "Not swept",
    notePlaceholder: "",
  },
  {
    id: "plot",
    label: "Empty plot",
    notePlaceholder: "empty plot — size, wall, gate, who to ask",
  },
  {
    id: "terrace",
    label: "Terrace",
    notePlaceholder: "terrace — building, floors, lift access, parapet",
  },
  {
    id: "rejected",
    label: "Rejected",
    notePlaceholder: "why it was rejected — so nobody walks it twice",
  },
] as const;

const STATUS_BY_ID = new Map(SWEEP_STATUSES.map((s) => [s.id, s]));

export function sweepStatusLabel(status: SweepCellStatus): string {
  return STATUS_BY_ID.get(status)?.label ?? status;
}

export function sweepNotePlaceholder(status: SweepCellStatus): string {
  return STATUS_BY_ID.get(status)?.notePlaceholder ?? "";
}

/** The next status a click produces. Unknown values restart the cycle. */
export function nextSweepStatus(current: SweepCellStatus): SweepCellStatus {
  const index = SWEEP_CYCLE.indexOf(current);
  return SWEEP_CYCLE[(index + 1) % SWEEP_CYCLE.length] ?? "plot";
}

/**
 * The status one click *back* — what a cell held before the click that has
 * just landed.
 *
 * This exists for double-click-to-split. A double-click is two clicks: the
 * first one has already cycled the cell by the time `dblclick` fires, so the
 * quadrants would inherit a mark the surveyor never chose.
 *
 * v16 solved this by deferring every click behind a 230 ms timer so a
 * double-click could cancel it. That works, but it puts a fifth of a second of
 * lag on the primary interaction of the screen — and a sweep is dozens of
 * clicks a minute. Rewinding one step at `dblclick` time is exact, and costs
 * nothing.
 */
export function previousSweepStatus(current: SweepCellStatus): SweepCellStatus {
  const index = SWEEP_CYCLE.indexOf(current);
  if (index === -1) return "none";
  return SWEEP_CYCLE[(index - 1 + SWEEP_CYCLE.length) % SWEEP_CYCLE.length] ?? "none";
}

/**
 * Split a cell after a double-click, undoing the stray first click.
 *
 * Kept here rather than in the screen so the "a double-click must not also
 * mark the cell" rule is a property of the model and is tested as one.
 */
export function splitCellOnDoubleClick(
  cells: readonly SweepCell[],
  id: string,
): SweepCell[] {
  const rewound = cells.map((c) =>
    c.id === id ? { ...c, status: previousSweepStatus(c.status) } : c,
  );
  return splitCell(rewound, id);
}

/** A latitude/longitude box, in the north/south/east/west form Leaflet and v16 both use. */
export interface SweepBounds {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

export interface SweepCell {
  /** `A1`, or `A1c` for the third quadrant of a split cell. */
  readonly id: string;
  readonly status: SweepCellStatus;
  readonly note: string;
  readonly bounds: SweepBounds;
  /** True when a double-click may split it. Quadrants do not split again. */
  readonly splittable: boolean;
}

export interface SweepDocument {
  /** Bumped if the cell shape ever changes; a stored sweep says what it is. */
  readonly version: 1;
  /** Cell edge length in metres on the ground, as the surveyor chose it. */
  readonly cellSizeM: number;
  /** The box the grid was laid over. */
  readonly bounds: SweepBounds;
  readonly cells: readonly SweepCell[];
  /** ISO timestamp of the last save, for the "saved" indicator. */
  readonly updatedAt: string | null;
}

/** Cell sizes offered on the screen, in metres. v16's list, plus a 250 m step. */
export const SWEEP_CELL_SIZES_M: readonly number[] = [200, 250, 500, 1000] as const;

/**
 * Refuse to lay a grid bigger than this.
 *
 * v16's ceiling was 300. It exists because a zoomed-out view at 200 m cells is
 * thousands of rectangles: the browser stops responding, and a grid nobody can
 * read is not a sweep. Refusing with the number in the message is more useful
 * than a spinner that never ends.
 */
export const SWEEP_MAX_CELLS = 300;

/** Metres per degree of latitude. Constant enough at any latitude we scan. */
const M_PER_DEG_LAT = 111_320;

export function metresToDegreesLat(metres: number): number {
  return metres / M_PER_DEG_LAT;
}

/**
 * Metres to degrees of longitude at a given latitude.
 *
 * A degree of longitude shrinks with `cos(lat)`. Ignoring that would make every
 * cell in Bengaluru 2.5 % wider than it is tall, which sounds harmless until a
 * surveyor uses the grid to judge whether a plot is big enough for a 5-a-side
 * pitch.
 */
export function metresToDegreesLng(metres: number, atLat: number): number {
  const scale = Math.cos((atLat * Math.PI) / 180);
  // Guard the poles: a grid there is meaningless, but it must not divide by 0.
  return metres / (M_PER_DEG_LAT * Math.max(scale, 1e-6));
}

/** Spreadsheet-style column names: A…Z, AA, AB… */
export function columnName(index: number): string {
  let i = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (i % 26)) + out;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return out;
}

export interface GridPlan {
  readonly cells: SweepCell[];
  readonly cols: number;
  readonly rows: number;
  /** Set when the plan was refused; `cells` is then empty. */
  readonly refusedReason: string | null;
}

/**
 * Lay a grid of `cellSizeM` cells over `bounds`.
 *
 * Never throws — the sweep screen calls this as the map moves, and an exception
 * there is a blank map. An oversized plan comes back with `refusedReason` and
 * no cells.
 */
export function planGrid(
  bounds: SweepBounds,
  cellSizeM: number,
  maxCells: number = SWEEP_MAX_CELLS,
): GridPlan {
  const north = Math.max(bounds.north, bounds.south);
  const south = Math.min(bounds.north, bounds.south);
  const east = Math.max(bounds.east, bounds.west);
  const west = Math.min(bounds.east, bounds.west);

  const size = Number.isFinite(cellSizeM) && cellSizeM > 0 ? cellSizeM : 500;
  const midLat = (north + south) / 2;
  const dLat = metresToDegreesLat(size);
  const dLng = metresToDegreesLng(size, midLat);

  const cols = Math.max(1, Math.ceil((east - west) / dLng));
  const rows = Math.max(1, Math.ceil((north - south) / dLat));

  if (cols * rows > maxCells) {
    return {
      cells: [],
      cols,
      rows,
      refusedReason:
        `That view needs ${cols * rows} cells at ${size} m. Zoom in closer, or pick a bigger ` +
        `cell size — above ${maxCells} the grid stops being something you can read.`,
    };
  }

  const cells: SweepCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellNorth = north - r * dLat;
      const cellWest = west + c * dLng;
      cells.push({
        id: `${columnName(c)}${r + 1}`,
        status: "none",
        note: "",
        splittable: true,
        bounds: {
          north: cellNorth,
          south: cellNorth - dLat,
          west: cellWest,
          east: cellWest + dLng,
        },
      });
    }
  }

  return { cells, cols, rows, refusedReason: null };
}

/**
 * Replace one cell with its four quadrants, suffixed `a`–`d`.
 *
 * Quadrants are not splittable again: v16 stopped at one level and it is the
 * right call. Two levels of split produce sixteen cells inside one square, and
 * `A1ca` is an id nobody can read back to a colleague over the phone.
 */
export function splitCell(cells: readonly SweepCell[], id: string): SweepCell[] {
  const target = cells.find((c) => c.id === id);
  if (!target || !target.splittable) return [...cells];

  const b = target.bounds;
  const midLat = (b.north + b.south) / 2;
  const midLng = (b.east + b.west) / 2;

  const quads: Array<[string, SweepBounds]> = [
    ["a", { north: b.north, south: midLat, west: b.west, east: midLng }],
    ["b", { north: b.north, south: midLat, west: midLng, east: b.east }],
    ["c", { north: midLat, south: b.south, west: b.west, east: midLng }],
    ["d", { north: midLat, south: b.south, west: midLng, east: b.east }],
  ];

  const out: SweepCell[] = [];
  for (const cell of cells) {
    if (cell.id !== id) {
      out.push(cell);
      continue;
    }
    for (const [suffix, bounds] of quads) {
      out.push({
        id: `${id}${suffix}`,
        // The quadrants inherit the parent's mark: splitting a cell you have
        // already called an empty plot is a request to be more precise about
        // *where*, not a retraction.
        status: cell.status,
        note: cell.note,
        bounds,
        splittable: false,
      });
    }
  }
  return out;
}

export function cellCentre(bounds: SweepBounds): { lat: number; lng: number } {
  return {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  };
}

/** Ground width and height of a cell, in metres — shown on the marked-cell row. */
export function cellSizeMetres(bounds: SweepBounds): { widthM: number; heightM: number } {
  const midLat = (bounds.north + bounds.south) / 2;
  const heightM = Math.abs(bounds.north - bounds.south) * M_PER_DEG_LAT;
  const widthM =
    Math.abs(bounds.east - bounds.west) *
    M_PER_DEG_LAT *
    Math.max(Math.cos((midLat * Math.PI) / 180), 1e-6);
  return { widthM: Math.round(widthM), heightM: Math.round(heightM) };
}

/** Google Maps satellite deep link for a cell, as v16 produced it. */
export function satelliteLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lng}&zoom=19&basemap=satellite`;
}

/** Street View deep link — "walk it" without leaving the desk. */
export function streetViewLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

/** Cells the surveyor actually marked, in id order. */
export function markedCells(cells: readonly SweepCell[]): SweepCell[] {
  return cells.filter((c) => c.status !== "none").sort((a, b) => a.id.localeCompare(b.id));
}

export interface SweepCounts {
  readonly plot: number;
  readonly terrace: number;
  readonly rejected: number;
  readonly marked: number;
  readonly total: number;
}

export function countCells(cells: readonly SweepCell[]): SweepCounts {
  let plot = 0;
  let terrace = 0;
  let rejected = 0;
  for (const cell of cells) {
    if (cell.status === "plot") plot++;
    else if (cell.status === "terrace") terrace++;
    else if (cell.status === "rejected") rejected++;
  }
  return { plot, terrace, rejected, marked: plot + terrace + rejected, total: cells.length };
}

/** RFC 4180 quoting: every field quoted, embedded quotes doubled. */
function csvField(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export const SWEEP_CSV_HEADER = [
  "cell",
  "status",
  "note",
  "lat",
  "lng",
  "width_m",
  "height_m",
  "satellite_link",
  "streetview_link",
] as const;

/**
 * CSV of every marked cell, matching v16's columns plus the cell's real size.
 *
 * The size is new: a row saying "empty plot" is far more useful to whoever
 * follows it up if it also says the cell was 250 m across.
 */
export function sweepToCsv(cells: readonly SweepCell[]): string {
  const rows: string[][] = [[...SWEEP_CSV_HEADER]];
  for (const cell of markedCells(cells)) {
    const centre = cellCentre(cell.bounds);
    const size = cellSizeMetres(cell.bounds);
    rows.push([
      cell.id,
      sweepStatusLabel(cell.status),
      cell.note,
      centre.lat.toFixed(6),
      centre.lng.toFixed(6),
      String(size.widthM),
      String(size.heightM),
      satelliteLink(centre.lat, centre.lng),
      streetViewLink(centre.lat, centre.lng),
    ]);
  }
  return rows.map((r) => r.map(csvField).join(",")).join("\n");
}

/* ------------------------------------------------------- persistence I/O */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBounds(raw: unknown): SweepBounds | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (
    !isFiniteNumber(b.north) ||
    !isFiniteNumber(b.south) ||
    !isFiniteNumber(b.east) ||
    !isFiniteNumber(b.west)
  ) {
    return null;
  }
  return { north: b.north, south: b.south, east: b.east, west: b.west };
}

const NOTE_MAX = 500;

/**
 * Parse a stored or submitted sweep, dropping anything malformed.
 *
 * Dropped, never repaired. A cell with no bounds cannot be drawn or linked to,
 * and inventing bounds for it would put a marker on ground nobody looked at.
 */
export function parseSweepDocument(raw: unknown): SweepDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  const bounds = parseBounds(doc.bounds);
  if (!bounds) return null;
  if (!Array.isArray(doc.cells)) return null;

  const seen = new Set<string>();
  const cells: SweepCell[] = [];
  for (const entry of doc.cells) {
    if (!entry || typeof entry !== "object") continue;
    const c = entry as Record<string, unknown>;
    if (typeof c.id !== "string" || c.id.length === 0 || c.id.length > 12) continue;
    if (seen.has(c.id)) continue;
    const cellBounds = parseBounds(c.bounds);
    if (!cellBounds) continue;
    const status = SWEEP_CYCLE.includes(c.status as SweepCellStatus)
      ? (c.status as SweepCellStatus)
      : "none";
    seen.add(c.id);
    cells.push({
      id: c.id,
      status,
      note: typeof c.note === "string" ? c.note.slice(0, NOTE_MAX) : "",
      bounds: cellBounds,
      splittable: c.splittable !== false,
    });
  }

  const cellSizeM = isFiniteNumber(doc.cellSizeM) && doc.cellSizeM > 0 ? doc.cellSizeM : 500;

  return {
    version: 1,
    cellSizeM,
    bounds,
    cells,
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
  };
}

/**
 * Trim a sweep to what is worth storing.
 *
 * Unmarked cells are dropped: they are reproducible from `bounds` and
 * `cellSizeM` by `planGrid`, and storing three hundred of them per scan would
 * put a kilobyte of nothing in every row. The marked ones carry their own
 * bounds so a restored sweep is exact even if the surveyor later changes the
 * cell size.
 */
export function packSweepDocument(doc: SweepDocument, now: string): SweepDocument {
  return {
    version: 1,
    cellSizeM: doc.cellSizeM,
    bounds: doc.bounds,
    cells: markedCells(doc.cells),
    updatedAt: now,
  };
}

/**
 * Merge a stored sweep back onto a freshly planned grid.
 *
 * The stored marks win, and a stored cell that no longer lines up with the new
 * grid — because the cell size changed, or it is a quadrant — is kept as its
 * own cell rather than discarded. Losing a surveyor's note because they
 * changed a dropdown would be unforgivable.
 */
export function restoreMarks(
  planned: readonly SweepCell[],
  stored: readonly SweepCell[],
): SweepCell[] {
  const byId = new Map(stored.map((c) => [c.id, c]));

  /**
   * Ids that were split last time.
   *
   * A stored `B1c` means `B1` was split into quadrants; drawing the planned
   * `B1` as well would put a full-size cell on top of its own four children
   * and every click would land on the wrong one.
   */
  const splitParents = new Set<string>();
  for (const cell of stored) {
    const parent = cell.id.slice(0, -1);
    if (parent.length > 0 && /[a-d]$/.test(cell.id)) splitParents.add(parent);
  }

  const out: SweepCell[] = [];
  const used = new Set<string>();

  for (const cell of planned) {
    if (splitParents.has(cell.id)) continue;
    const saved = byId.get(cell.id);
    if (saved) {
      used.add(cell.id);
      out.push({ ...cell, status: saved.status, note: saved.note });
    } else {
      out.push(cell);
    }
  }

  // A stored cell the new plan does not contain — a quadrant, or a cell from a
  // different cell size — keeps its own bounds rather than being discarded.
  // Losing a surveyor's note because they changed a dropdown is unforgivable.
  for (const cell of stored) {
    if (!used.has(cell.id)) out.push(cell);
  }

  return out;
}
