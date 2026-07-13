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
import { sectionForItem } from "./sections";

export type Sport =
  | "football"
  | "basketball"
  | "multisport"
  | "pickleball"
  | "tennis"
  | "volleyball"
  | "cricket"
  | "badminton";
export const SUPPORTED_SPORTS: Sport[] = [
  "football",
  "basketball",
  "multisport",
  "pickleball",
  "tennis",
  "volleyball",
  "cricket",
  "badminton",
];

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
  // Scope section this item groups under (Base Preparation, Sports Flooring…).
  // Absent on legacy sheets → inferred from the name at load time. Kept as a
  // plain string; sectionForItem() normalises it onto the fixed set.
  section?: string;
};

// Ensure every item has a concrete `section` (explicit wins, else inferred from
// the name) so the wizard / editor / PDF can group consistently.
function withSections(items: RateSheetItem[]): RateSheetItem[] {
  return items.map((it) => ({ ...it, section: sectionForItem(it) }));
}

export const FOOTBALL_DEFAULTS: RateSheetItem[] = [
  {
    id: "chemical_treatment",
    name: "Chemical Treatment",
    description:
      "Chemical treatment of the entire area to make the land infertile, applied manually by spraying of the required chemicals.",
    areaMode: "plot",
    defaultRate: 1,
    gstPercent: 18,
    optional: true,
  },
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
    id: "chemical_treatment",
    name: "Chemical Treatment",
    description:
      "Chemical treatment of the entire area to make the land infertile, applied manually by spraying of the required chemicals.",
    areaMode: "plot",
    defaultRate: 2,
    gstPercent: 18,
    optional: true,
  },
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

// Tennis turnkey defaults — outdoor acrylic hard court on an asphalt base.
// Rates from the client "SAMPLE QUOTES CLIENT RATES" sheet (Tennis, 7200
// sq.ft). Toe wall + drain are per running ft (perimeter); LED converted
// to per sq.ft to match the tool's other lighting lines.
export const TENNIS_DEFAULTS: RateSheetItem[] = [
  {
    id: "tennis_chemical",
    name: "Chemical Treatment",
    description:
      "Chemical treatment of the entire area to make the land infertile, applied manually by spraying.",
    areaMode: "plot",
    defaultRate: 3,
    gstPercent: 18,
    optional: true,
  },
  {
    id: "tennis_subbase",
    name: "Sub Base (Asphalt)",
    description:
      "Subgrade excavation (~22.5 cm), grading to ≤0.2% slope, compaction to Proctor 98%, then a bitumen base — 100mm WMM + 50mm asphalt + seal coat.",
    areaMode: "plot",
    defaultRate: 97,
    gstPercent: 5,
  },
  {
    id: "tennis_acrylic",
    name: "Acrylic Sports Surface (ITF, 8-layer)",
    description:
      "Pacecourt ITF-certified 8-layer acrylic system: primer ×1, resurfacer (asphalt transformer) ×3, cushion ×2, colour ×2, with international line marking.",
    areaMode: "plot",
    defaultRate: 57,
    gstPercent: 5,
  },
  {
    id: "tennis_toe_wall",
    name: "Toe Wall (per running ft)",
    description:
      "Toe wall around the court, exposed face painted with cement paint in two coats. Priced per running foot.",
    areaMode: "perimeter",
    defaultRate: 280,
    gstPercent: 18,
    optional: true,
  },
  {
    id: "tennis_drain",
    name: 'Open Saucer Drain (6") (per running ft)',
    description:
      '6-inch open saucer drain with MS jali cover. Priced per running foot.',
    areaMode: "perimeter",
    defaultRate: 220,
    gstPercent: 18,
    optional: true,
  },
  {
    id: "tennis_fencing",
    name: "Chain Link Fence (12 ft)",
    description:
      "MS pipe 50×50mm chain-link fencing, 12 ft height on concrete foundation 2 ft below ground, 35mm ties at top & bottom, red oxide + 2 coats oil paint, one 7'×3' door.",
    areaMode: "plot",
    defaultRate: 118,
    gstPercent: 18,
  },
  {
    id: "tennis_post",
    name: "Tennis Post (fixed, with net)",
    description:
      "Fixed-type tennis post with brass ratchet, 450×450×450mm foundation below floor level, suitable net and centre tape.",
    areaMode: "per_piece",
    defaultRate: 49500,
    gstPercent: 18,
  },
  {
    id: "tennis_lights",
    name: "LED Flood Lights",
    description:
      "150W LED floodlights with a weatherproof double-door distribution board, earthing electrode and full wiring from board to fixtures.",
    areaMode: "plot",
    defaultRate: 19,
    gstPercent: 18,
  },
];

// Volleyball / throwball turnkey defaults — 50mm FIFA turf on a PCC base
// with Garware nets. Rates from the client sheet (Volleyball, 4056 sq.ft).
export const VOLLEYBALL_DEFAULTS: RateSheetItem[] = [
  {
    id: "volleyball_chemical",
    name: "Chemical Treatment",
    description:
      "Chemical treatment of the entire area to make the land infertile, applied manually by spraying.",
    areaMode: "plot",
    defaultRate: 4,
    gstPercent: 18,
    optional: true,
  },
  {
    id: "volleyball_subbase",
    name: "Sub Base (PCC M20)",
    description:
      "Excavation + disposal, grading to ≤0.2% slope, compaction to Proctor 98%, then 100mm compacted PCC in M20 grade.",
    areaMode: "plot",
    defaultRate: 96,
    gstPercent: 18,
  },
  {
    id: "volleyball_turf",
    name: "Sports Flooring — 50mm FIFA-Quality Turf",
    description:
      "FIFA-quality 50mm monofilament artificial turf (pile 50mm, gauge 5/8\", ~8850 tufts/m², 1530 g/m² pile weight, UV-stabilised), installed.",
    areaMode: "plot",
    defaultRate: 113,
    gstPercent: 5,
  },
  {
    id: "volleyball_fabrication",
    name: "Fabrication & Net Framing (25 ft)",
    description:
      "MS structure — 3\"×3\"×3mm verticals, 2\"×2\"×2mm horizontals, entry gate, base plates, 25 ft height, colour & painting.",
    areaMode: "plot",
    defaultRate: 92,
    gstPercent: 18,
  },
  {
    id: "volleyball_side_nets",
    name: "Garware Side Nets (50×50×2.5mm)",
    description:
      "Side Garware nets 50×50×2.5mm installed with dodge clips, hooks, steel wire ropes and accessories.",
    areaMode: "plot",
    defaultRate: 15,
    gstPercent: 18,
  },
  {
    id: "volleyball_top_nets",
    name: "Garware Top Nets (25×25×1.5mm)",
    description:
      "Top Garware nets 25×25×1.5mm installed with dodge clips, hooks, steel wire ropes and accessories.",
    areaMode: "plot",
    defaultRate: 15,
    gstPercent: 18,
  },
  {
    id: "volleyball_lights",
    name: "LED Flood Lights (200W)",
    description:
      "200W LED floodlights with a weatherproof double-door distribution board, earthing electrode and full wiring.",
    areaMode: "plot",
    defaultRate: 36,
    gstPercent: 18,
  },
];

// Cricket practice-pitch turnkey defaults — 13mm cricket turf on a PCC
// base with Garware nets. Rates from the client sheet (Cricket, 2460 sq.ft).
export const CRICKET_DEFAULTS: RateSheetItem[] = [
  {
    id: "cricket_chemical",
    name: "Chemical Treatment",
    description:
      "Chemical treatment of the entire area to make the land infertile, applied manually by spraying.",
    areaMode: "plot",
    defaultRate: 4,
    gstPercent: 18,
    optional: true,
  },
  {
    id: "cricket_subbase",
    name: "Sub Base (PCC M20)",
    description:
      "Excavation + disposal, grading to ≤0.2% slope, compaction to Proctor 98%, then 100mm compacted PCC in M20 grade.",
    areaMode: "plot",
    defaultRate: 96,
    gstPercent: 18,
  },
  {
    id: "cricket_turf",
    name: "Sports Flooring — 13mm Cricket Turf (ITF)",
    description:
      "ITF-quality 13mm cricket turf (stitch 320/m, Dtex 6600, gauge 1/4\", PE curly yarn, 3-layer backing) with European seam tape & glue.",
    areaMode: "plot",
    defaultRate: 98,
    gstPercent: 5,
  },
  {
    id: "cricket_fabrication",
    name: "Fabrication & Net Framing (15 ft)",
    description:
      "MS structure — 3\"×3\"×3mm verticals, 2\"×2\"×2mm horizontals, entry gate, base plates, 15 ft height, colour & painting.",
    areaMode: "plot",
    defaultRate: 92,
    gstPercent: 18,
  },
  {
    id: "cricket_side_nets",
    name: "Garware Side Nets (35×35×2.5mm)",
    description:
      "Side Garware nets 35×35×2.5mm installed with dodge clips, hooks, steel wire ropes and accessories.",
    areaMode: "plot",
    defaultRate: 16,
    gstPercent: 18,
  },
  {
    id: "cricket_top_nets",
    name: "Garware Top Nets (35×35×2.5mm)",
    description:
      "Top Garware nets 35×35×2.5mm installed with dodge clips, hooks, steel wire ropes and accessories.",
    areaMode: "plot",
    defaultRate: 16,
    gstPercent: 18,
  },
  {
    id: "cricket_lights",
    name: "LED Flood Lights (200W)",
    description:
      "200W LED floodlights with a weatherproof double-door distribution board, earthing electrode and full wiring.",
    areaMode: "plot",
    defaultRate: 59,
    gstPercent: 18,
  },
];

// Indoor badminton turnkey defaults — a covered hall: BWF vinyl flooring
// per sq.ft, plus the MS shell, civil works and lighting as lump sums
// (edit per court count). Rates from "INDOOR BADMINTON 1" (4-court hall).
export const BADMINTON_DEFAULTS: RateSheetItem[] = [
  {
    id: "badminton_flooring",
    name: "BWF Vinyl Sports Flooring",
    description:
      "BWF-compliant synthetic vinyl sports flooring — 0.5mm playing layer, dual-cushion multi-layer shock absorption, crystal-sand grip finish, UV-stable.",
    areaMode: "plot",
    defaultRate: 122,
    gstPercent: 18,
  },
  {
    id: "badminton_structure",
    name: "Indoor Shell — MS Structure & Roofing",
    description:
      "MS structure: base plates, foundation bolts, 150×5mm SHS pillars, 60×40 trusses, 80×40×2.4mm purlins, connecting plates & gussets, with 0.5mm colour-coated roof and side cladding. Lump sum for the hall.",
    areaMode: "per_piece",
    defaultRate: 2430000,
    gstPercent: 18,
  },
  {
    id: "badminton_civil",
    name: "Civil Works (footings, plinth, walls, plastering)",
    description:
      "Footing excavation + PCC, isolated footings & pedestals (Fe550 TMT, M25), plinth beam (M20), 6\" solid-block walls, two-side plastering, RCC sub-flooring and painting. Lump sum for the hall.",
    areaMode: "per_piece",
    defaultRate: 2360000,
    gstPercent: 18,
  },
  {
    id: "badminton_lighting",
    name: "BWF Lighting (150W linear, 6 per court)",
    description:
      "BWF-recommended 150W linear lights (6 per court) with full wiring, IP65 weatherproof DBs/MCBs & main board, surge protection and Osram LED drivers. Lump sum.",
    areaMode: "per_piece",
    defaultRate: 750000,
    gstPercent: 18,
  },
];

const SPORT_DEFAULTS: Record<Sport, RateSheetItem[]> = {
  football: FOOTBALL_DEFAULTS,
  basketball: BASKETBALL_DEFAULTS,
  multisport: MULTISPORT_DEFAULTS,
  pickleball: PICKLEBALL_DEFAULTS,
  tennis: TENNIS_DEFAULTS,
  volleyball: VOLLEYBALL_DEFAULTS,
  cricket: CRICKET_DEFAULTS,
  badminton: BADMINTON_DEFAULTS,
};

function settingKeyForSport(sport: Sport): string {
  return `quotation_${sport}_rates`;
}

export async function getRatesForSport(sport: Sport): Promise<RateSheetItem[]> {
  const fallback = SPORT_DEFAULTS[sport] ?? [];
  const row = await prisma.setting.findUnique({
    where: { key: settingKeyForSport(sport) },
  });
  if (!row) return withSections(fallback);
  try {
    const parsed = JSON.parse(row.value) as RateSheetItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return withSections(fallback);
    return withSections(parsed);
  } catch {
    return withSections(fallback);
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
