// Editable, PERSISTED material sizes for the court-designer flooring calculator.
// Stored in the `settings` table (single JSON row under KEY_MATERIAL_SIZES) with
// code-level defaults = today's hardcoded constants (schema.ts), so before an
// admin ever edits them the calculator behaves exactly as it did when the sizes
// were baked in. Mirrors the read/write shape of src/lib/meta-ads/config.ts
// (prisma.setting.findMany / prisma.setting.upsert with defaults filled in).

import { prisma } from "@/lib/prisma";

const KEY_MATERIAL_SIZES = "court_material_sizes";

export type MaterialSizes = {
  // Artificial-grass roll size (metres). Defaults 2 × 25 (TURF_ROLL_*).
  turfRollWidthM: number;
  turfRollLengthM: number;
  // PVC sports-flooring roll size (metres). Defaults 1.8 × 20 (PVC_ROLL_*).
  pvcRollWidthM: number;
  pvcRollLengthM: number;
  // Interlocking PP/PPE tile edge length (cm) — square tile. Default 30 (matches
  // PPE_TILE_FT ≈ 0.984 ft). Carried through to ppeTileCount as feet.
  ppTileCm: number;
  // Tile build-up thickness (mm) — DISPLAY ONLY, never enters the area math.
  ppTileThicknessMm: number;
  // Ordering wastage buffer (%) applied to the raw roll/tile count.
  wastagePct: number;
};

// Defaults = the constants schema.ts used before these became editable.
export const DEFAULT_MATERIAL_SIZES: MaterialSizes = {
  turfRollWidthM: 2,
  turfRollLengthM: 25,
  pvcRollWidthM: 1.8,
  pvcRollLengthM: 20,
  ppTileCm: 30,
  ppTileThicknessMm: 0,
  wastagePct: 10,
};

// A finite, non-negative number or the default. Divisor fields (roll/tile sizes)
// additionally must be > 0 so the estimate never divides by zero.
function num(v: unknown, fallback: number, mustBePositive: boolean): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (mustBePositive && n <= 0) return fallback;
  return n;
}

function fillDefaults(p: Partial<MaterialSizes>): MaterialSizes {
  const d = DEFAULT_MATERIAL_SIZES;
  return {
    turfRollWidthM: num(p.turfRollWidthM, d.turfRollWidthM, true),
    turfRollLengthM: num(p.turfRollLengthM, d.turfRollLengthM, true),
    pvcRollWidthM: num(p.pvcRollWidthM, d.pvcRollWidthM, true),
    pvcRollLengthM: num(p.pvcRollLengthM, d.pvcRollLengthM, true),
    ppTileCm: num(p.ppTileCm, d.ppTileCm, true),
    ppTileThicknessMm: num(p.ppTileThicknessMm, d.ppTileThicknessMm, false),
    wastagePct: num(p.wastagePct, d.wastagePct, false),
  };
}

export async function getMaterialSizes(): Promise<MaterialSizes> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [KEY_MATERIAL_SIZES] } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const raw = byKey.get(KEY_MATERIAL_SIZES);

  let parsed: Partial<MaterialSizes> = {};
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") parsed = obj as Partial<MaterialSizes>;
    } catch {
      // Corrupt / legacy value — fall back to defaults below.
    }
  }
  return fillDefaults(parsed);
}

export async function setMaterialSizes(partial: Partial<MaterialSizes>): Promise<void> {
  // Merge onto the current stored values so a partial update (one field) keeps
  // the rest; fillDefaults re-validates the merged result before persisting.
  const current = await getMaterialSizes();
  const merged = fillDefaults({ ...current, ...partial });
  const value = JSON.stringify(merged);

  await prisma.setting.upsert({
    where: { key: KEY_MATERIAL_SIZES },
    update: { value },
    create: { key: KEY_MATERIAL_SIZES, value },
  });
}
