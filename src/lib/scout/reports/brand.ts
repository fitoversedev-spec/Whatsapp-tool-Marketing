/**
 * The report's identity block and legal footer.
 *
 * Client requirement **D5** asks for a legal company name, registered address,
 * contact number, email, website and optionally a GST/CIN. As of 19 Aug 2026
 * every one of those is still blank in `plan/CLIENT-INPUTS.md`, so they are
 * read from the environment and **omitted when unset** rather than printed as
 * a placeholder. A footer reading "Registered address: TBC" on a document a
 * land owner shows their CA is worse than a footer that simply does not claim
 * one.
 *
 * ## The disclaimer, and the one word changed
 *
 * D5's disclaimer wording was agreed on 18 Aug 2026 and is printed verbatim
 * with a **single deletion**: the draft says the report "uses publicly
 * available data and modelled population estimates". No population data is
 * ingested in this build (`docs/PHASE-2-HANDOFF.md`), so that clause describes
 * a source the report does not rest on — and the limitations section three
 * pages later says so explicitly. Printing both would put the document in
 * contradiction with itself. The clause is dropped, the rest is untouched, and
 * `docs/PHASE-6-HANDOFF.md` flags it for the client to re-confirm.
 */

export interface ReportBrand {
  readonly productName: string;
  readonly legalName: string;
  /** Address, phone, email, website, GST/CIN — whichever are configured. */
  readonly contactLines: readonly string[];
  readonly disclaimer: string;
  /** Google is the only data source this build uses, so the only one credited. */
  readonly attribution: string;
}

export const REPORT_DISCLAIMER =
  "This report is a preliminary desk survey prepared for screening purposes. It uses publicly " +
  "available data. It does not constitute financial, investment, legal or planning advice, and " +
  "contains no projection of revenue or return. Land ownership, title, zoning, pricing and " +
  "tenure are outside its scope. Any site decision requires independent ground verification and " +
  "professional advice.";

/**
 * Attribution.
 *
 * Google only. WorldPop, Census 2011 and SHRUG are named nowhere on the
 * document: none of them is used, and crediting a source implies the figures
 * rest on it.
 */
export const REPORT_ATTRIBUTION = "Place data © Google. Collected through the Google Places API.";

/** The short line under a Maps Static API image, which Google requires. */
export const STATIC_MAP_ATTRIBUTION = "Map data © Google";

function trimmed(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value !== "PASTE_HERE" ? value : undefined;
}

export function reportBrand(): ReportBrand {
  const lines: string[] = [];
  const address = trimmed("REPORT_LEGAL_ADDRESS");
  const phone = trimmed("REPORT_CONTACT_PHONE");
  const email = trimmed("REPORT_CONTACT_EMAIL");
  const website = trimmed("REPORT_WEBSITE");
  const registration = trimmed("REPORT_REGISTRATION");

  if (address) lines.push(address);
  const contact = [phone, email, website].filter(Boolean).join(" · ");
  if (contact) lines.push(contact);
  if (registration) lines.push(registration);

  return {
    productName: "Fitoverse Site Scout",
    legalName: trimmed("REPORT_LEGAL_NAME") ?? "Fitoverse",
    contactLines: lines,
    disclaimer: REPORT_DISCLAIMER,
    attribution: REPORT_ATTRIBUTION,
  };
}

/**
 * Fonts.
 *
 * Client requirement **B4** is Azonix (display) and Gilroy (body). Neither has
 * been supplied, so the document uses the same substitutes the application
 * uses — Orbitron for display, Poppins for body — and falls back through the
 * generic families when neither is installed on the rendering machine. The PDF
 * therefore renders identically to what the studio preview shows, which is the
 * property that matters until the real files arrive.
 *
 * These are named here, in one place, so swapping them is a two-line change
 * plus an `@font-face` block pointing at the licensed files.
 */
export const REPORT_FONT_STACKS = {
  display: `Orbitron, "Trebuchet MS", "Segoe UI", Helvetica, Arial, sans-serif`,
  body: `Poppins, "Segoe UI", Helvetica, Arial, sans-serif`,
} as const;

export const FONT_SUBSTITUTION_NOTE =
  "Set in Orbitron and Poppins, standing in for the brand faces until the licensed files are supplied.";
