// Default rate sheet for Football turf turnkey quotations.
// Mirrors the line items in Fitoverse's standard quote (Word reference):
//   Sub Base → Turf → Nylon Net → Fencing → Lightings → Padding.
//
// Stored in the Setting table under key DEFAULT_RATES_KEY so admins and
// sales can update without a code deploy. Falls back to FOOTBALL_DEFAULTS
// (defined here) if the Setting row is missing or malformed.
//
// Each item carries its own areaMode so the calculator knows whether to
// multiply by plot area (sub-base, turf, fencing, lighting), wrap area
// (nylon net = perimeter × 35ft + top), or piece count (padding).

import { prisma } from "@/lib/prisma";

export type AreaMode = "plot" | "wrap" | "per_piece";

export type RateSheetItem = {
  id: string;
  name: string;
  description: string; // editable per-quote; this is the default
  areaMode: AreaMode;
  defaultRate: number; // INR per sq.ft, or per piece for "per_piece" items
  gstPercent: number;
  // Optional metadata only used by some areaModes
  wrapHeightFt?: number; // for "wrap" mode (nylon net height)
  optional?: boolean; // shows unchecked by default
};

export const FOOTBALL_DEFAULTS: RateSheetItem[] = [
  {
    id: "sub_base",
    name: "Sub Base",
    description:
      "Crush Stone Sub Base 150MM (100MM-WMM, 30MM-12 & 20MM Blue Metals, 20MM-6MM Baby chips & M Sand Bed). Edge wall (1 ft height wall constructed with hollow bricks & plastered 3 inch below ground level and 9 inch above ground level). With necessary drainage arrangement of 6 inch PVC pipe with holes along the length of the ground. Supply and spreading of geotextile sheet on compacted soil surface.",
    areaMode: "plot",
    defaultRate: 75,
    gstPercent: 5,
  },
  {
    id: "turf",
    name: "Artificial Turf for Multisports",
    description:
      "Model: Non Infill 30mm Turf. Dtex: 13000 +10%. Roll Size: 20mx2m and 4mx20m. Pile height: 30mm±1mm. Yarn Structure: Monofilament curl. Gauge: 3/8 inch. Stitches per 10cm: 20+3%. Turf Withdrawal force - half tuft ≥ 40N. Total yarn weight: 1900/m² ±10%. Total carpet weight: 2750g/m² ±10%. Water Permeability ≥ 180mm/h. Infill: Sand 0.5-1.6mm. Bulk density: 10kg/m² +15%. AND Cricket Turf 9mm (Usage: Cricket Multisports, Pile Height 9mm, Color Green Red, Fibrillated, Dtex 8800±10%, Stitch Rate 34/10cm, Gauge 3/16, Size 2m × 10m, Total yarn weight 1520/m² ±10%).",
    areaMode: "plot",
    defaultRate: 112,
    gstPercent: 5,
  },
  {
    id: "nylon_net",
    name: "Nylon Net",
    description:
      "Installation of Nylon Net all around. Vertical net Garware makes 50mm × 50mm × 2.5mm thick. Top net 50mm × 50mm × 1.75mm thick. Wire rope: Complete fixing of wire ropes of 5mm with turnbuckle & dog clip.",
    areaMode: "wrap",
    wrapHeightFt: 35,
    defaultRate: 12,
    gstPercent: 5,
  },
  {
    id: "fencing",
    name: "Fencing",
    description:
      "Supply, fabrication & installation of steel structure with foundations for net framing around perimeter of sports court with necessary vertical and horizontal pipe structure support at regular intervals including all doors & locks. 35 feet height from ground level. Square vertical pole (75mm × 75mm × 4.0mm). Vertical pole to pole distance 15 feet. Top, centre & bottom horizontal pipe support. Square horizontal pipe size (50mm × 50mm × 2mm). One single door: 7' × 3'. Red oxide and 2 coats of oil paint.",
    areaMode: "plot",
    defaultRate: 70,
    gstPercent: 18,
  },
  {
    id: "lightings",
    name: "Lightings",
    description:
      "Supply and installation of complete lighting to the ground with illumination level of 250-300 lux level with standard LED fittings (maximum 28 nos) including complete standard wiring connecting to main switch board. Client's scope: providing main electrical board.",
    areaMode: "plot",
    defaultRate: 33,
    gstPercent: 18,
  },
  {
    id: "padding",
    name: "Padding",
    description: "Rexine cloth with foam and velcro backing.",
    areaMode: "per_piece",
    defaultRate: 1500,
    gstPercent: 18,
    optional: true,
  },
];

const DEFAULT_RATES_KEY = "quotation_football_rates";

export async function getFootballRates(): Promise<RateSheetItem[]> {
  const row = await prisma.setting.findUnique({ where: { key: DEFAULT_RATES_KEY } });
  if (!row) return FOOTBALL_DEFAULTS;
  try {
    const parsed = JSON.parse(row.value) as RateSheetItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return FOOTBALL_DEFAULTS;
    return parsed;
  } catch {
    return FOOTBALL_DEFAULTS;
  }
}

export async function setFootballRates(items: RateSheetItem[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: DEFAULT_RATES_KEY },
    create: { key: DEFAULT_RATES_KEY, value: JSON.stringify(items) },
    update: { value: JSON.stringify(items) },
  });
}
