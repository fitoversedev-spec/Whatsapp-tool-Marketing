function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Base ────────────────────────────────────────────────────────────────────

export type PdfSectionBase = {
  id: string;
  order: number;
  highlighted: boolean;
  visible: boolean;
};

// ── Per-type shapes ─────────────────────────────────────────────────────────

export type CoverSection = PdfSectionBase & {
  type: "cover";
  companyName: string;
  gstin: string;
  cin: string;
  phone: string;
  cities: string;
  projectTitle?: string;
};

export type ParticularsSection = PdfSectionBase & { type: "particulars" };
export type ComparisonSection = PdfSectionBase & { type: "comparison" };
export type TotalsSection = PdfSectionBase & { type: "totals" };
export type SpecCardsSection = PdfSectionBase & { type: "spec_cards" };

export type NotesSection = PdfSectionBase & {
  type: "notes";
  lines: string[];
};

export type ClientScopeSection = PdfSectionBase & {
  type: "client_scope";
  lines: string[];
};

export type PaymentTermsSection = PdfSectionBase & {
  type: "payment_terms";
  milestones: [string, string][];
};

export type BankDetailsSection = PdfSectionBase & {
  type: "bank_details";
  rows: [string, string][];
};

export type TermsSection = PdfSectionBase & {
  type: "terms";
  clauses: { title: string; body: string }[];
};

export type SignaturesSection = PdfSectionBase & {
  type: "signatures";
  directorName: string;
  directorTitle: string;
};

export type AdvantageSection = PdfSectionBase & {
  type: "advantage";
  paragraphs: string[];
  memberships: string;
  certifications: string;
  stats: [string, string][];
};

export type ConnectSection = PdfSectionBase & {
  type: "connect";
  phone: string;
  socialLinks: [string, string, string][];
};

export type PhotoSection = PdfSectionBase & {
  type: "photo";
  imageUrl: string;
  caption?: string;
};

export type CustomTextSection = PdfSectionBase & {
  type: "custom_text";
  title: string;
  body: string;
};

export type PdfSection =
  | CoverSection
  | ParticularsSection
  | ComparisonSection
  | TotalsSection
  | SpecCardsSection
  | NotesSection
  | ClientScopeSection
  | PaymentTermsSection
  | BankDetailsSection
  | TermsSection
  | SignaturesSection
  | AdvantageSection
  | ConnectSection
  | PhotoSection
  | CustomTextSection;

export type PdfSectionType = PdfSection["type"];

// ── Labels + categories ─────────────────────────────────────────────────────

export const SECTION_LABELS: Record<PdfSectionType, string> = {
  cover: "Cover page",
  particulars: "Particulars table",
  comparison: "Option comparison",
  totals: "Totals",
  spec_cards: "Spec cards",
  notes: "Notes",
  client_scope: "Client work scope",
  payment_terms: "Payment terms",
  bank_details: "Bank details",
  terms: "Terms & conditions",
  signatures: "Signatures",
  advantage: "Fitoverse advantage",
  connect: "Connect with us",
  photo: "Photo",
  custom_text: "Custom section",
};

export const AUTO_SECTIONS: PdfSectionType[] = [
  "particulars",
  "comparison",
  "totals",
  "spec_cards",
];

export const TEMPLATE_SECTIONS: PdfSectionType[] = [
  "cover",
  "notes",
  "client_scope",
  "payment_terms",
  "bank_details",
  "terms",
  "signatures",
  "advantage",
  "connect",
];

export const CUSTOM_SECTIONS: PdfSectionType[] = ["photo", "custom_text"];

export function sectionCategory(
  type: PdfSectionType,
): "auto" | "template" | "custom" {
  if ((AUTO_SECTIONS as string[]).includes(type)) return "auto";
  if ((CUSTOM_SECTIONS as string[]).includes(type)) return "custom";
  return "template";
}

// ── Sport-specific installation milestone (mirrors pdf.ts logic) ────────────

function installationMilestone(sport: string): string {
  switch (sport) {
    case "basketball":
      return "installation of basketball poles";
    case "football":
      return "installation of goal posts & nets";
    case "cricket":
      return "installation of nets & fencing";
    case "tennis":
      return "installation of net posts & fencing";
    case "badminton":
    case "volleyball":
    case "pickleball":
      return "installation of net posts";
    case "multisport":
      return "installation of poles, nets & fixtures";
    default:
      return "installation of sports fixtures";
  }
}

// ── Default template ────────────────────────────────────────────────────────

function sec(order: number): Pick<PdfSectionBase, "id" | "order" | "highlighted" | "visible"> {
  return { id: genId(), order, highlighted: false, visible: true };
}

export function buildDefaultSections(sport: string): PdfSection[] {
  return [
    {
      ...sec(0),
      type: "cover",
      companyName: "Fitoverse Private Limited",
      gstin: "33AAECF8905G1ZQ",
      cin: "U92490TZ2022PTC038004",
      phone: "6381502055",
      cities: "Salem  ·  Chennai  ·  Bangalore",
    },
    { ...sec(1), type: "particulars" },
    { ...sec(2), type: "comparison" },
    { ...sec(3), type: "totals" },
    { ...sec(4), type: "spec_cards" },
    {
      ...sec(5),
      type: "notes",
      lines: [
        "Installation charges are included in the above rates.",
        "GST is charged extra as shown; ground preparation carries no GST.",
        "Freight / transport charges extra for materials at actuals.",
        "Client's scope: levelled ground to be provided; power, water and handling support at site.",
        "Food and stay for the installation team on client scope.",
        "Unloading, shifting and storage at the project site on client scope.",
        "Warranty as applicable to the selected surface, excluding damage from misuse, vandalism or natural calamities.",
      ],
    },
    {
      ...sec(6),
      type: "client_scope",
      lines: [
        "Site to be ready, clean and levelled before commencement.",
        "Power, water, unloading, shifting and storage support at site.",
        "Food and stay for the installation team.",
      ],
    },
    {
      ...sec(7),
      type: "payment_terms",
      milestones: [
        ["50%", "advance during purchase order"],
        ["30%", "during flooring work"],
        ["15%", `after ${installationMilestone(sport)}`],
        ["5%", "after completion of work"],
      ],
    },
    {
      ...sec(8),
      type: "bank_details",
      rows: [
        ["Account Name", "FITOVERSE PVT LTD"],
        ["Bank Name", "HDFC BANK"],
        ["Branch", "BRINDHAVAN ROAD"],
        ["Account No", "50200066429411"],
        ["IFSC", "HDFC0001281"],
      ],
    },
    {
      ...sec(9),
      type: "terms",
      clauses: [
        {
          title: "1. Commercial Terms & Payment",
          body: "1.1 Instruments of Payment: All payments must be made in favor of 'FITOVERSE PRIVATE LIMITED' via Demand Draft or At-Par Cheque. 1.2 Validity of Offer: The rates outlined in this proposal are valid subject to the award of the minimum area indicated in the quotation. 1.3 Binding Agreement: This offer becomes a binding contract upon the receipt of a formal Purchase Order (PO) from the Client, accompanied by the stipulated Advance Payment. 1.4 Taxes & Duties: Any statutory upward or downward revision in tax rates, or the introduction of new applicable taxes, shall be borne by the Client.",
        },
        {
          title: "2. Project Schedule & Execution",
          body: "2.1 Lead Time: The project timeline shall be determined based on the total area and scope confirmed in the Purchase Order. 2.2 Commencement: Fitoverse agrees to commence Installation Services within a reasonable timeframe, subject to favorable weather conditions and site readiness. 2.3 Site Access: Upon commencement, the Client must provide 100% unhindered access to the site. 2.4 Delays: Any work stoppage caused by the Client or site conditions will attract proportionate hold-up costs.",
        },
        {
          title: "3. Material Ownership",
          body: "3.1 Surplus Material: Any surplus synthetic surfacing products or extra materials shipped to the site due to requirements shall remain the property of Fitoverse.",
        },
        {
          title: "4. Warranty & Limitation of Liability",
          body: "4.1 General Liability: The liability of Fitoverse regarding any breach of warranty or defect in labor/materials shall strictly not exceed the total value of the Installation Services paid by the Client to Fitoverse. 4.2 Exclusions: Under no circumstances shall Fitoverse be liable for any consequential, punitive, liquidated, or special damages.",
        },
        {
          title: "5. Force Majeure",
          body: "5.1 Fitoverse shall not be liable for any failure or delay in performance due to causes beyond its reasonable control, including acts of God, war, riots, strikes, labor disputes, floods, fire, explosions, shortage of water/power/transportation, government orders, or customs delays.",
        },
        {
          title: "6. Dispute Resolution & Jurisdiction",
          body: "6.1 Mediation & Arbitration: In the event of a dispute, both parties agree to first seek resolution through a mediator. Failing this, the dispute shall be referred to Arbitration. 6.2 Jurisdiction: Any and all unresolved disputes shall be subject to the exclusive jurisdiction of the courts in Salem, Tamil Nadu.",
        },
      ],
    },
    {
      ...sec(10),
      type: "signatures",
      directorName: "Vignesh Manikandan",
      directorTitle: "Director",
    },
    {
      ...sec(11),
      type: "advantage",
      paragraphs: [
        "Fitoverse Sports Infra is synonymous with world-class sports construction. We bridge the gap between natural playability and modern engineering, offering surfaces that replicate the best qualities of natural fields while significantly reducing maintenance costs and eliminating game cancellations due to weather or uneven terrain.",
        "We pride ourselves on being a single-source provider. When you partner with Fitoverse, you engage a team capable of handling the entire project lifecycle - from planning, design, and subfloor construction to professional lighting and precision installation.",
        "Our commitment to quality is validated by our adherence to the rigorous standards set by global governing bodies, including FIFA, World Rugby, FIH, ITF, and FIBA.",
      ],
      memberships: "IAKS   ·   SFBA India",
      certifications: "FIFA Quality   ·   FIFA Quality Pro",
      stats: [
        ["65+", "infra projects"],
        ["4 Lakh+", "Sq. Ft. Covered"],
      ],
    },
    {
      ...sec(12),
      type: "connect",
      phone: "+91 63815 02055",
      socialLinks: [
        ["Portfolio", "View our projects", "https://fitoverse.com/"],
        ["Website", "fitoverse.com", "https://fitoverse.com/"],
        ["Instagram", "fito.verse", "https://www.instagram.com/fito.verse/"],
        ["LinkedIn", "Fitoverse", "https://www.linkedin.com/company/fitoverse/"],
        ["Facebook", "Fitoverse", "https://www.facebook.com/profile.php?id=100077279349300"],
      ],
    },
  ];
}
