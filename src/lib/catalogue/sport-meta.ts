// Static sport-level copy used by the catalogue PDF generator. Treat
// this as content + presets, not "code" — the user is going to hand us
// real Fitoverse marketing copy + pricing soon and we'll just swap the
// values below.
//
// Each sport has:
//   - tagline / hero pitch (1 sentence under the sport name on the cover)
//   - overview paragraph (1-2 sentences on the first page)
//   - variants table (what court types we build)
//   - surface tiers (entry / standard / premium - with what's included)
//   - "why Fitoverse" closing bullets (sport-specific differentiators)
//
// Heavy lifting (full reference spec for every sport) lives in
// /scripts/generate-court-designer-guide.ts. This file is the *sales*
// version — shorter, tighter, customer-facing.

export type SportKey =
  | "football"
  | "cricket"
  | "basketball"
  | "pickleball"
  | "tennis"
  | "badminton"
  | "volleyball"
  | "multisport";

export type SurfaceTier = {
  name: string; // "Entry" | "Standard" | "Premium"
  description: string;
  // Free-form list of "Spec: value" pairs rendered as a checklist.
  inclusions: string[];
  // Optional indicative starting price for the tier (per sq.ft).
  // Set to undefined to hide the price line — content provided later.
  priceFromInr?: string;
};

export type SportMeta = {
  key: SportKey;
  label: string;
  tagline: string;
  overview: string;
  variants: { headers: string[]; rows: string[][]; widthRatios?: number[] };
  surfaceTiers: SurfaceTier[];
  whyFitoverse: string[];
};

export const SPORT_META: Record<SportKey, SportMeta> = {
  football: {
    key: "football",
    label: "Football Turf",
    tagline: "Turnkey football turf solutions - 5-a-side to FIFA-grade 11-a-side.",
    overview:
      "Fitoverse designs, supplies, and installs football turfs across South India for commercial box-cricket-style rentals, schools, residential societies, and clubs. Every build covers sub-base prep, turf laying, infill, line-marking, goal posts, fencing, and lighting.",
    variants: {
      headers: ["Format", "Recommended size", "Best for"],
      rows: [
        ["5-a-side", "82-138ft x 49-82ft", "Box turf / fitness / society"],
        ["7-a-side", "164-213ft x 98-148ft", "Commercial rental"],
        ["11-a-side (club)", "328-360ft x 210-245ft", "School / club ground"],
        ["11-a-side (FIFA)", "344ft x 223ft", "Tournament-grade"],
      ],
      widthRatios: [1, 1.5, 1.4],
    },
    surfaceTiers: [
      {
        name: "Entry",
        description: "Ideal for kids' facilities and budget builds.",
        inclusions: [
          "40mm artificial grass",
          "SBR rubber + sand infill",
          "Compacted earth + sand sub-base",
          "Standard chain-link fencing 8ft",
          "Halogen flood lighting",
        ],
      },
      {
        name: "Standard",
        description: "Most common commercial spec - balances cost and durability.",
        inclusions: [
          "50mm 3rd-generation grass",
          "SBR rubber infill",
          "Concrete + shock-pad sub-base",
          "Welded mesh fencing 10ft",
          "LED flood lighting 200-300W",
          "Aluminium goal posts",
        ],
      },
      {
        name: "Premium",
        description: "FIFA-quality build for serious clubs and tournaments.",
        inclusions: [
          "60mm professional turf",
          "TPE or cork+coconut infill",
          "Full concrete base + shock-pad",
          "Tournament-grade fencing + roof netting",
          "LED flood lighting 300-400W",
          "Premium goals + dugouts + scoreboard",
        ],
      },
    ],
    whyFitoverse: [
      "In-house design, supply, install - single point of accountability",
      "Sub-base + drainage handled end-to-end (no third-party civil work needed)",
      "FIFA-compliant turfs sourced from approved manufacturers",
      "Maintenance + warranty contracts available on every build",
    ],
  },

  cricket: {
    key: "cricket",
    label: "Cricket Pitch & Ground",
    tagline:
      "Box cricket, junior grounds, and full-size outfields - including the 22-yard pitch.",
    overview:
      "Whether you're building a box-cricket facility, a school ground, or a club outfield, Fitoverse handles the pitch (cement / astro turf / coir / clay) and the surrounding outfield together. We size the pitch (9 to 22 yards) to your players and the plot.",
    variants: {
      headers: ["Type", "Pitch", "Boundary"],
      rows: [
        ["Box cricket", "12 yd (36ft)", "60-80ft x 30-50ft enclosed"],
        ["Compact net cricket", "22 yd (66ft)", "Narrow enclosed"],
        ["Junior ground", "22 yd", "50-60m boundary"],
        ["Club ground", "22 yd", "65-75m boundary"],
        ["International grade", "22 yd", "75-90m boundary"],
      ],
    },
    surfaceTiers: [
      {
        name: "Entry",
        description: "Cost-conscious build for kids' coaching academies.",
        inclusions: [
          "9-16 yard pitch (coir or synthetic matting)",
          "Compacted earth outfield",
          "Basic netting 25ft",
        ],
      },
      {
        name: "Standard",
        description: "Box cricket and school spec.",
        inclusions: [
          "22 yard or 12 yard cement concrete pitch",
          "50mm artificial turf outfield",
          "Box cricket netting 30ft with side wickets",
          "Sight screens",
        ],
      },
      {
        name: "Premium",
        description: "Club-grade outfield with maintained natural grass.",
        inclusions: [
          "22 yard clay or premium synthetic pitch",
          "Natural grass outfield with roller + irrigation",
          "Boundary rope + perimeter chain-link fence",
          "Scoreboard + spectator seating",
        ],
      },
    ],
    whyFitoverse: [
      "Multi-pitch facilities (9/12/16/22 yard) for mixed-age coaching",
      "Pitch + outfield delivered together - no two-vendor coordination",
      "Box cricket builds with full netting + lighting in 3 weeks",
      "Maintenance plans for natural-grass outfields",
    ],
  },

  basketball: {
    key: "basketball",
    label: "Basketball Court",
    tagline: "3-on-3 to NBA-size full courts, acrylic or wooden surfaces.",
    overview:
      "Fitoverse builds half-courts (3-on-3, FIBA), full-courts (FIBA + NBA), driveway hoops, and indoor pro-grade wooden floors. The hoop is included in the build - in-ground, portable, or wall-mounted - with regulation backboards.",
    variants: {
      headers: ["Type", "Dimensions", "Best for"],
      rows: [
        ["3-on-3 / FIBA half", "41ft x 49.2ft", "Schools / clubs / events"],
        ["Junior half", "30-40ft x 25-35ft", "Residential / kids"],
        ["Driveway recreational", "30-50ft x 20-30ft", "Home use"],
        ["5-on-5 FIBA full", "91.86ft x 49.2ft", "Commercial / tournament"],
        ["5-on-5 NBA full", "94ft x 50ft", "Premium"],
      ],
      widthRatios: [1.3, 1.4, 1.5],
    },
    surfaceTiers: [
      {
        name: "Entry",
        description: "Residential half-court or driveway play area.",
        inclusions: [
          "Concrete slab + 2-coat acrylic sports paint",
          "Standard markings (one tone)",
          "Portable hoop with sand-filled base",
          "Steel mesh backboard",
        ],
      },
      {
        name: "Standard",
        description: "School and club half / full court.",
        inclusions: [
          "Concrete + 4-coat acrylic + cushion layer",
          "FIBA two-tone markings",
          "In-ground steel pole with adjustable height",
          "Acrylic / polycarbonate backboard",
          "Chain-link 12ft fencing",
        ],
      },
      {
        name: "Premium",
        description: "Indoor pro-grade or showcase outdoor court.",
        inclusions: [
          "Wooden parquet OR cushioned PU sports flooring",
          "Tempered-glass backboards with spring rims",
          "Tournament markings + key colored",
          "Scoreboard + spectator bench",
          "LED flood lighting (indoor + outdoor)",
        ],
      },
    ],
    whyFitoverse: [
      "Pole supply, foundation digging, and installation done in-house",
      "Glass backboards available for tournament-grade builds",
      "Acrylic flooring carries 5-year warranty on cracking + peeling",
      "Modular tile option for rapid setup / portable courts",
    ],
  },

  pickleball: {
    key: "pickleball",
    label: "Pickleball Court",
    tagline:
      "Fastest-growing racquet sport - 20ft x 44ft court that fits any plot.",
    overview:
      "Pickleball is exploding in urban India - rooftops, driveways, club courts. Fitoverse delivers regulation 20x44ft courts with acrylic surface, regulation net + posts, and full perimeter fencing. We build singles, doubles, and tournament configurations.",
    variants: {
      headers: ["Type", "Court", "Total area (with buffer)"],
      rows: [
        ["Singles", "20ft x 44ft", "30ft x 60ft"],
        ["Doubles", "20ft x 44ft (same)", "30ft x 60ft"],
        ["Tournament", "20ft x 44ft", "34ft x 64ft with full run-off"],
      ],
    },
    surfaceTiers: [
      {
        name: "Entry",
        description: "Quick driveway / rooftop install.",
        inclusions: [
          "Concrete slab + acrylic topcoat",
          "Standard markings",
          "Net + steel posts",
          "Chain-link 8ft fencing",
        ],
      },
      {
        name: "Standard",
        description: "Club-grade with full run-off.",
        inclusions: [
          "Concrete + cushioned acrylic surface",
          "Tournament markings",
          "Premium net + posts",
          "10ft chain-link with gate",
          "LED flood lighting",
        ],
      },
      {
        name: "Premium",
        description: "Multi-court tournament facility.",
        inclusions: [
          "Cushioned acrylic with side colour zones",
          "Spectator seating",
          "Tournament-grade net + posts",
          "Roof netting + perimeter wall",
          "Scoreboard + court signage",
        ],
      },
    ],
    whyFitoverse: [
      "Indian pickleball federation-approved court specs",
      "Multi-court facilities planned to maximise plot usage",
      "Cushioned acrylic option for joint protection",
      "Lighting + fencing included so courts are night-playable",
    ],
  },

  tennis: {
    key: "tennis",
    label: "Tennis Court",
    tagline: "Hard court, clay, grass, or synthetic - singles and doubles.",
    overview:
      "Fitoverse builds tennis courts to standard ITF specs with full run-off zones. Hard court (acrylic) is the most common in India, but we also do clay (red or green), synthetic grass, and natural grass for premium clubs.",
    variants: {
      headers: ["Type", "Court", "Recommended total"],
      rows: [
        ["Singles", "27ft x 78ft", "60ft x 120ft"],
        ["Doubles", "36ft x 78ft", "60ft x 120ft"],
        ["Junior 10U (red ball)", "18ft x 60ft", "-"],
        ["Junior 12U (orange ball)", "23ft x 78ft", "-"],
      ],
    },
    surfaceTiers: [
      {
        name: "Entry",
        description: "Recreational hard court for residential / school.",
        inclusions: [
          "Concrete slab + 2-coat acrylic",
          "Standard ITF markings",
          "Net + steel posts",
          "Chain-link 10ft fencing",
        ],
      },
      {
        name: "Standard",
        description: "Club-grade hard court.",
        inclusions: [
          "Cushioned acrylic surface",
          "Full run-off zones",
          "Umpire chair",
          "12ft fencing with gates",
          "LED flood lighting",
        ],
      },
      {
        name: "Premium",
        description: "Tournament-grade clay or championship hard court.",
        inclusions: [
          "Red / green clay OR cushioned premium acrylic",
          "Sub-surface drainage system",
          "Spectator seating + shade canopy",
          "Scoreboard + court signage",
          "Maintenance contract",
        ],
      },
    ],
    whyFitoverse: [
      "ITF-approved court specifications",
      "Multi-court facilities for academies",
      "Clay court maintenance + irrigation services available",
      "Indoor and outdoor variants",
    ],
  },

  badminton: {
    key: "badminton",
    label: "Badminton Court",
    tagline: "Indoor regulation courts - PVC vinyl, wooden, or PU flooring.",
    overview:
      "Badminton needs ceiling height (25ft minimum) and a non-glare floor. Fitoverse supplies PVC vinyl mats (most common), wooden parquet (premium), and cushioned PU sports flooring for academies.",
    variants: {
      headers: ["Type", "Court"],
      rows: [
        ["Singles", "17ft x 44ft"],
        ["Doubles", "20ft x 44ft (same court)"],
        ["Minimum ceiling", "25ft"],
      ],
      widthRatios: [1.3, 2],
    },
    surfaceTiers: [
      {
        name: "Entry",
        description: "Society / amateur play.",
        inclusions: [
          "Synthetic acrylic surface",
          "Standard markings",
          "Net + portable posts",
        ],
      },
      {
        name: "Standard",
        description: "Coaching academy / club.",
        inclusions: [
          "PVC vinyl mat (4.5mm)",
          "Tournament markings",
          "In-ground net posts",
          "LED court lighting",
        ],
      },
      {
        name: "Premium",
        description: "Indoor pro-grade.",
        inclusions: [
          "Wooden parquet OR cushioned PU flooring",
          "BWF-approved lighting",
          "Spectator seating",
          "Scoreboard + court signage",
        ],
      },
    ],
    whyFitoverse: [
      "BWF-approved court mats and specs",
      "Multi-court indoor halls planned end-to-end",
      "Lighting designed to eliminate shuttle glare",
      "Maintenance contracts for premium floors",
    ],
  },

  volleyball: {
    key: "volleyball",
    label: "Volleyball Court",
    tagline: "Indoor regulation, beach, or recreational outdoor.",
    overview:
      "Fitoverse builds indoor volleyball (wood / PU / PVC), beach volleyball (30cm sand depth), and synthetic outdoor courts. Net heights configurable for men's, women's, and mixed play.",
    variants: {
      headers: ["Type", "Dimensions"],
      rows: [
        ["Indoor regulation", "29.5ft x 59ft"],
        ["Beach volleyball", "26.25ft x 52.5ft"],
        ["Recreational", "Smaller variants accepted"],
      ],
    },
    surfaceTiers: [
      {
        name: "Entry",
        description: "School / society outdoor.",
        inclusions: ["Compacted earth + synthetic grass", "Net + portable posts"],
      },
      {
        name: "Standard",
        description: "Indoor club court.",
        inclusions: [
          "PVC sports flooring",
          "Regulation net + padded posts",
          "Court lighting",
        ],
      },
      {
        name: "Premium",
        description: "Beach or pro-grade indoor.",
        inclusions: [
          "30cm sand depth (beach) OR wooden floor (indoor)",
          "Tournament markings",
          "Spectator seating",
          "Scoreboard",
        ],
      },
    ],
    whyFitoverse: [
      "Beach sand sourced + filtered to spec",
      "Indoor floors with FIVB-approved markings",
      "Padded posts for safety",
      "Multi-purpose halls combining volleyball + basketball + badminton",
    ],
  },

  multisport: {
    key: "multisport",
    label: "Multisport Facility",
    tagline: "Combine 2-3 sports on one plot - football + cricket is the classic.",
    overview:
      "Most Indian box-turf operators combine football + cricket on the same plot. Fitoverse designs multi-marking layouts (color-coded lines) so the same surface serves multiple sports without compromising play quality.",
    variants: {
      headers: ["Combination", "Why"],
      rows: [
        ["Football + Cricket", "Most common box-turf - shares artificial turf"],
        ["Basketball + Pickleball", "Same rectangular acrylic court"],
        ["Tennis + Pickleball", "Same court size, different lines"],
        [
          "Football + Basketball + Volleyball",
          "Large multi-purpose ground",
        ],
        [
          "Indoor (Badminton + Basketball + Volleyball)",
          "Sports hall",
        ],
      ],
      widthRatios: [1.5, 2],
    },
    surfaceTiers: [
      {
        name: "Entry",
        description: "2 sports, basic surface, mixed markings.",
        inclusions: [
          "Single surface (artificial turf or acrylic)",
          "Primary + secondary sport markings",
          "Standard fencing",
        ],
      },
      {
        name: "Standard",
        description: "2-3 sports with color-coded markings and full equipment.",
        inclusions: [
          "Pro-grade surface (turf or cushioned acrylic)",
          "Up to 3 sets of markings, color-coded",
          "All sport-specific equipment",
          "LED flood lighting",
          "Fencing 10-12ft",
        ],
      },
      {
        name: "Premium",
        description: "Showcase facility for clubs / commercial operators.",
        inclusions: [
          "Premium surface with cushion layer",
          "Tournament markings for primary sport",
          "Full equipment for every sport",
          "Spectator seating + dugouts",
          "Scoreboard, signage, premium lighting",
        ],
      },
    ],
    whyFitoverse: [
      "Single surface + marking strategy designed for play quality across sports",
      "Equipment packages bundled for each combination",
      "Booking-friendly designs (multiple courts on one plot when feasible)",
      "Lower overall cost than building separate facilities",
    ],
  },
};

export function getSportMeta(sport: string): SportMeta | null {
  return (SPORT_META as Record<string, SportMeta>)[sport] ?? null;
}
