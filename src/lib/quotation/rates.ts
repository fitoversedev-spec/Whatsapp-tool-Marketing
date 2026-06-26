// Default rate sheets per sport. Each sport has its own line items because
// turnkey scope differs (Football has turf + nylon net; Basketball has
// acrylic flooring + posts; future sports will add their own).
//
// Stored in the Setting table under key `quotation_<sport>_rates` so admins
// and sales can update without a code deploy. Falls back to the *_DEFAULTS
// constant defined here if the Setting row is missing or malformed.
//
// Each item carries its own areaMode so the calculator knows whether to
// multiply by plot area, wrap area (perimeter-based), or piece count.

import { prisma } from "@/lib/prisma";

export type Sport = "football" | "basketball" | "multisport" | "pickleball";
export const SUPPORTED_SPORTS: Sport[] = ["football", "basketball", "multisport", "pickleball"];

export type AreaMode = "plot" | "wrap" | "per_piece" | "perimeter";

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

// Basketball court turnkey defaults — derived from Fitoverse's Cauvery
// Group of Institutions quote (Mysuru). Posts and lighting are billed per
// piece; flooring/sub-base/fencing use the plot area.
export const BASKETBALL_DEFAULTS: RateSheetItem[] = [
  {
    id: "basketball_post",
    name: "Basketball Movable Post with Board (Pair)",
    description:
      "Basketball post with 20mm thickness clear Acrylic Glass Board as per International Standards. Movable post pair with shock-absorbing rims.",
    areaMode: "per_piece",
    defaultRate: 230000,
    gstPercent: 18,
  },
  {
    id: "asphalt_sub_base",
    name: "Sub Base (Asphalt)",
    description:
      "ASPHALT SUB BASE - 150 MM (100MM WMM, 30MM DBM, 20MM AC & SEAL COAT). WMM (Wet Mix Macadam): laid to 150mm consolidated thickness with watering and rolling. Tack coat on WMM using emulsion at approximately 5 kg bitumen per 10m². DBM (Dense Bituminous Macadam): 40mm compacted using 20mm down-size aggregate with VG30 grade hot bitumen. Tack coat on DBM at approximately 2.5 kg bitumen per 10m². Seal/Wearing Course (Premix): consolidated to 10mm thickness using VG30 grade bitumen, finished to proper slope and surface texture. Includes machinery, fuel and standard site labour.",
    areaMode: "plot",
    defaultRate: 132,
    gstPercent: 5,
  },
  {
    id: "edge_wall",
    name: "Edge Wall",
    description:
      "1 ft height wall constructed with hollow bricks and plastered, 3 inch below GL and 9 inch above GL. Provides perimeter containment for the synthetic flooring system.",
    areaMode: "per_piece",
    defaultRate: 130000,
    gstPercent: 5,
  },
  {
    id: "synthetic_flooring",
    name: "Synthetic / Acrylic Sports Flooring (ITF Certified, 8 Layer System)",
    description:
      "ITF-certified 8-layer synthetic acrylic flooring system with installation. Layers: 1. Primer, 2. Resurfacer Coat 1st, 3. Resurfacer Coat 2nd, 4. Cushion 1st Coat, 5. Cushion 2nd Coat, 6. Cushion 3rd Coat, 7. Color Coat 1st, 8. Color Coat 2nd, plus Top Color 3rd with line marking.",
    areaMode: "plot",
    defaultRate: 72,
    gstPercent: 5,
  },
  {
    id: "basketball_fencing",
    name: "Basketball Court Fencing",
    description:
      "Chain link fencing 2.5mm thickness. 15 feet height from ground level. Square vertical pole (75mm × 75mm × 4.0mm). Vertical pole-to-pole distance 15 feet. Top, centre & bottom horizontal pipe support. Square horizontal pipe size (50mm × 50mm × 2mm). One single door: 7' × 3'. Red oxide and 2 coats of oil paint.",
    areaMode: "plot",
    defaultRate: 55,
    gstPercent: 18,
  },
  {
    id: "flood_lights",
    name: "Flood Lights",
    description:
      "4 MS poles of 22 feet height from base. 150 watts LED floodlights, four on each pole (total 16 lights). 500-750 lux illumination, suitable for evening play and broadcast-quality visibility.",
    areaMode: "per_piece",
    defaultRate: 650000,
    gstPercent: 18,
  },
];

// Multisport turnkey defaults — Fitoverse's simplest package. Just the
// foundational sub-base; sales adds court-specific items per quote via the
// wizard's "+ Add custom line item" button (football turf, basketball
// posts, fencing, etc. — whatever the customer specifies).
export const MULTISPORT_DEFAULTS: RateSheetItem[] = [
  {
    id: "sub_base",
    name: "Sub Base",
    description:
      "Crush Stone Sub Base 150MM (100MM-WMM, 30MM-12 & 20MM Blue Metals, 20MM-6MM Baby chips & M Sand Bed). Edge wall (1 ft height wall constructed with hollow bricks & plastered 3 inch below ground level and 9 inch above ground level). With necessary drainage arrangement of 6 inch PVC pipe with holes along the length of the ground. Supply and spreading of geotextile sheet on compacted soil surface.",
    areaMode: "plot",
    defaultRate: 106,
    gstPercent: 18,
  },
];

// Pickleball court turnkey defaults — derived from Fitoverse's Pickleball
// quote template. Uses the new "perimeter" area mode for the edge wall
// (priced per running ft rather than per sq.ft).
export const PICKLEBALL_DEFAULTS: RateSheetItem[] = [
  {
    id: "pickleball_subbase",
    name: "Sub Base",
    description:
      "Soil work up to 150MM. Wetmix up to 100MM thick. Steel 8MM dia @ 300MM centre-to-centre. M20 grade concrete up to 100MM thick with VDF (vacuum dewatered flooring) finish.",
    areaMode: "plot",
    defaultRate: 150,
    gstPercent: 18,
  },
  {
    id: "pickleball_edge_wall",
    name: "Edge Wall (per running ft)",
    description:
      "1 ft height wall constructed with hollow bricks and plastered, 3 inch below GL and 9 inch above GL. Priced per running foot of perimeter.",
    areaMode: "perimeter",
    defaultRate: 350,
    gstPercent: 18,
  },
  {
    id: "pickleball_flooring",
    name: "Synthetic / Acrylic Sports Flooring (ITF Certified, 8 Layer System)",
    description:
      "ITF-certified 8-layer synthetic acrylic flooring with installation. Layers: 1. Primer, 2. Resurfacer Coat 1st, 3. Resurfacer Coat 2nd, 4. Cushion 1st Coat, 5. Cushion 2nd Coat, 6. Cushion 3rd Coat, 7. Color Coat 1st, 8. Color Coat 2nd, plus Top Color 3rd with line marking.",
    areaMode: "plot",
    defaultRate: 75,
    gstPercent: 18,
  },
  {
    id: "pickleball_fencing",
    name: "Pickleball Court Fencing",
    description:
      "Chain link fencing 2.5mm thickness. 15 feet height from ground level. Square vertical pole (75mm × 75mm × 4.0mm). Vertical pole-to-pole distance 15 feet. Top, centre & bottom horizontal pipe support. Square horizontal pipe size (50mm × 50mm × 2mm). One single door: 7' × 3'. Red oxide and 2 coats of oil paint.",
    areaMode: "plot",
    defaultRate: 60,
    gstPercent: 18,
  },
  {
    id: "pickleball_lights",
    name: "Flood Lights",
    description:
      "2 MS poles of 22 feet height from base. 150 watts LED floodlights, four on each pole (total 8 lights). 500-750 lux illumination.",
    areaMode: "plot",
    defaultRate: 45,
    gstPercent: 18,
  },
  {
    id: "pickleball_post",
    name: "Pickleball Post (Tournament Grade)",
    description:
      "Tournament-quality post designed for performance, durability, and easy mobility. Official dimensions: 36 inches high × 264 inches long. Robust frame made with 50mm × 50mm MS pipe, 3mm thickness, finished with black baked-on polyester powder coating for long-lasting use. Weight: 77kg (including box packaging).",
    areaMode: "per_piece",
    defaultRate: 25000,
    gstPercent: 18,
  },
];

const SPORT_DEFAULTS: Record<Sport, RateSheetItem[]> = {
  football: FOOTBALL_DEFAULTS,
  basketball: BASKETBALL_DEFAULTS,
  multisport: MULTISPORT_DEFAULTS,
  pickleball: PICKLEBALL_DEFAULTS,
};

function settingKeyForSport(sport: Sport): string {
  return `quotation_${sport}_rates`;
}

export async function getRatesForSport(sport: Sport): Promise<RateSheetItem[]> {
  const fallback = SPORT_DEFAULTS[sport] ?? [];
  const row = await prisma.setting.findUnique({
    where: { key: settingKeyForSport(sport) },
  });
  if (!row) return fallback;
  try {
    const parsed = JSON.parse(row.value) as RateSheetItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

export async function setRatesForSport(sport: Sport, items: RateSheetItem[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: settingKeyForSport(sport) },
    create: { key: settingKeyForSport(sport), value: JSON.stringify(items) },
    update: { value: JSON.stringify(items) },
  });
}

// Back-compat shims — keep existing callers working until they migrate
// to the sport-aware versions above. Both delegate to "football".
export async function getFootballRates(): Promise<RateSheetItem[]> {
  return getRatesForSport("football");
}
export async function setFootballRates(items: RateSheetItem[]): Promise<void> {
  return setRatesForSport("football", items);
}
