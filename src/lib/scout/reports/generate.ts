import "server-only";

import { canAccessAllScans, type ScoutProfile } from "@/lib/scout/identity";
import { buildComparison } from "@/lib/scout/compare/model";
import { env } from "@/lib/scout/env";
import { formatFullDate } from "@/lib/scout/display/format";
import { CATEGORIES } from "@/lib/scout/places/taxonomy";
import { getCompareSubjects } from "@/lib/scout/scans/queries";

import { canGenerateAiSummary, generateAiSummary } from "./ai-summary";
import { reportBrand } from "./brand";
import { buildComparisonDocument, renderComparisonHtml } from "./comparison";
import { assembleReportInput } from "./data";
import { deliveryNote, reportDelivery, type DeliveryMode } from "./delivery";
import { buildReportDocument } from "./document";
import { PdfEngineUnavailableError, renderPdf } from "./pdf";
import { renderReportHtml } from "./render";
import { expiryFromNow, linkTtlDays, signReportLink } from "./signing";
import { normaliseRecipient } from "./share";
import {
  createGenerationRow,
  findLatestGenerationRow,
  findReportRow,
  getShareSubject,
  markReportFailed,
  markReportGenerated,
  nextReportVersion,
  recordShareRows,
  type ReportRow,
} from "./repository";
import { reportStorage, ReportTooLargeError } from "./storage";

/**
 * Generating a report, end to end.
 *
 * ## Why this is a background job
 *
 * A cold Chromium launch plus a page render is seconds, not milliseconds, and
 * a request that holds a connection open for eight seconds is a request that
 * times out on a phone with two bars of signal. `startReportGeneration` writes
 * a row and returns; the worker runs after the response; the screen polls and
 * shows Phase 5's "Report ready" card. Exactly the treatment scans already get,
 * for exactly the same reason.
 *
 * ## Why regeneration writes a new row
 *
 * Somebody may be reading v1 on WhatsApp while v2 is produced. Overwriting the
 * file under a live link would change the numbers in a document a customer is
 * looking at, with no way to tell that it happened. A new row means a new id,
 * a new signed link, and v1 stays retrievable until it expires — which is also
 * what makes "which version did we send Deepa?" an answerable question.
 */

export interface ReportGenerationRow {
  readonly id: string;
  readonly scanId: string;
  readonly version: number;
  readonly status: string;
  readonly title: string | null;
  readonly error: string | null;
  readonly pdfBytes: number | null;
  readonly pageCount: number | null;
  readonly pdfEngine: string | null;
  readonly generatedAt: string | null;
  readonly expiresAt: string | null;
  readonly scoreModelVersion: string | null;
  readonly channel: "whatsapp" | "pdf" | "email" | null;
  readonly sentTo: string | null;
  readonly sentAt: string | null;
}

function toRow(row: ReportRow): ReportGenerationRow {
  return {
    id: row.id,
    scanId: row.scanId,
    version: row.version,
    status: row.status,
    title: row.title,
    error: row.error,
    pdfBytes: row.pdfBytes,
    pageCount: row.pageCount,
    pdfEngine: row.pdfEngine,
    generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    scoreModelVersion: row.scoreModelVersion,
    channel: row.channel,
    sentTo: row.sentTo,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  };
}

/** The most recent generation attempt for a scan, draft rows excluded. */
export async function latestGeneratedReport(scanId: string): Promise<ReportGenerationRow | null> {
  const row = await findLatestGenerationRow(scanId);
  return row ? toRow(row) : null;
}

export async function getReportRow(reportId: string): Promise<ReportGenerationRow | null> {
  const row = await findReportRow(reportId);
  return row ? toRow(row) : null;
}

/**
 * Claim a row for a new generation. Returns the id the worker will fill in.
 *
 * The composition comes from the saved draft, so what generates is what the
 * studio was showing — Phase 4 made sure the draft is written before the
 * button is ever pressed.
 */
export async function startReportGeneration(
  author: ScoutProfile,
  scanId: string,
): Promise<ReportGenerationRow | null> {
  const input = await assembleReportInput(author, scanId, { skipMap: true });
  if (!input) return null;

  const row = await createGenerationRow({
    scanId,
    userId: author.userId,
    kind: "scan",
    title: `${input.areaLabel} — Site Scout report`,
    version: await nextReportVersion(scanId),
    includedBlocks: input.blocks as Record<string, boolean>,
    fieldNotes: input.fieldNotes ?? "",
    scoreModelVersion: input.score?.modelVersion ?? null,
  });

  return row ? toRow(row) : null;
}

export interface GenerationOutcome {
  readonly ok: boolean;
  readonly reportId: string;
  readonly error?: string;
}

/**
 * Do the work. Called from `after()`, never inside the request that started it.
 *
 * Every failure lands on the row as text a person can act on. A report row left
 * in `generating` for ever would be indistinguishable from one still running,
 * so the catch is total — including the "no Chromium anywhere" case, which is
 * the state of this environment today.
 */
export async function runReportGeneration(
  author: ScoutProfile,
  reportId: string,
): Promise<GenerationOutcome> {
  const existing = await getReportRow(reportId);
  if (!existing) return { ok: false, reportId, error: "The report row no longer exists." };

  try {
    const generatedAt = new Date();
    const input = await assembleReportInput(author, existing.scanId, {
      reportId,
      version: existing.version,
      generatedAt,
    });
    if (!input) throw new Error("The scan behind this report could not be read.");

    let aiSummaryText: string | null = null;
    if (input.blocks["ai-summary"] && canGenerateAiSummary()) {
      try {
        aiSummaryText = await generateAiSummary(author.userId, {
          areaLabel: input.areaLabel,
          radiusM: input.radiusM,
          competitionCount: input.competitionCount,
          demandCount: input.demandCount,
          avgRating: input.avgRating,
          reviewTotal: input.reviewTotal,
          categories: input.categories,
          places: input.places.map((p) => ({
            name: p.name,
            side: p.side,
            rating: p.rating,
            reviewCount: p.reviewCount,
            distanceM: p.distanceM,
          })),
          scoreTotal: input.score?.totalRounded ?? null,
          scoreVerdict: input.score?.verdict ?? null,
        });
      } catch (err) {
        console.error(JSON.stringify({ tag: "report.ai-summary.failed", reportId, error: err instanceof Error ? err.message : "unknown" }));
      }
    }

    const document = buildReportDocument({ ...input, aiSummaryText });
    const html = await renderReportHtml(document);
    const brand = reportBrand();

    const pdf = await renderPdf(html, {
      headerText: `${document.meta.areaLabel} · ${document.meta.radiusLabel} · Site Scout report v${document.meta.version}`,
      footerText: [brand.legalName, brand.attribution, "Preliminary desk survey — not financial, investment, legal or planning advice"]
        .filter(Boolean)
        .join(" · "),
    });

    const stored = await reportStorage().put(reportId, pdf.bytes);
    const expiresAt = expiryFromNow(generatedAt, linkTtlDays());

    await markReportGenerated(reportId, {
      blobKey: stored.key,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      pageCount: pdf.pageCount,
      engine: pdf.engine,
      generatedAt,
      expiresAt,
    });

    return { ok: true, reportId };
  } catch (error) {
    const message = failureMessage(error, "The report could not be generated");
    await markReportFailed(reportId, message);
    return { ok: false, reportId, error: message };
  }
}

/**
 * What the row records when generation fails.
 *
 * The two typed failures already carry a message written for a person — "no
 * Chromium is available", "the file is 6.2 MB". Anything else is wrapped so the
 * screen never shows a bare `TypeError` to a salesperson.
 */
function failureMessage(error: unknown, prefix: string): string {
  if (error instanceof PdfEngineUnavailableError || error instanceof ReportTooLargeError) {
    return error.message;
  }
  return `${prefix}: ${(error as Error).message}`;
}

/* ------------------------------------------------------------- the link */

export interface ReportLink {
  readonly url: string;
  readonly path: string;
  readonly expiresAt: string;
  readonly expiresOnLabel: string;
}

export function reportLink(reportId: string, expiresAt: Date): ReportLink {
  const signed = signReportLink(reportId, env.reportLinkSecret, expiresAt);
  return {
    url: `${env.appUrl.replace(/\/$/, "")}${signed.path}`,
    path: signed.path,
    expiresAt: expiresAt.toISOString(),
    expiresOnLabel: formatFullDate(expiresAt),
  };
}

/* ------------------------------------------------------------- sharing */

export interface ShareResult {
  /** The `wa.me` URL a person opens. `null` when the channel sends for itself. */
  readonly whatsappUrl: string | null;
  readonly mode: DeliveryMode;
  /** Wording that has to change with the mode, resolved once, here. */
  readonly deliveryNote: string;
  readonly message: string;
  readonly link: ReportLink;
  readonly recipientName: string | null;
}

/**
 * Log a share, hand back the `wa.me` link, and flip the scan's status.
 *
 * The status change is what drives D1's pill from "Scan only" to "Report sent",
 * and the recipient name is what lets the same card read "Sent to Deepa". Both
 * are recorded at the moment the salesperson actually hands the report over,
 * not when the file was produced — a generated report nobody sent is not a sent
 * report, and the dashboard must not claim it is.
 */
export async function recordShare(input: {
  readonly user: ScoutProfile;
  readonly reportId: string;
  readonly channel: "whatsapp" | "pdf" | "email";
  readonly recipientName?: unknown;
  readonly caption?: string;
}): Promise<ShareResult | null> {
  const row = await getReportRow(input.reportId);
  if (!row || !row.expiresAt) return null;

  const subject = await getShareSubject(row.scanId);
  if (!subject) return null;
  // Someone else's report is a 404 at the route, never a 403.
  if (subject.ownerId !== input.user.userId && !canAccessAllScans(input.user)) return null;

  const recipientName = normaliseRecipient(input.recipientName);
  const link = reportLink(row.id, new Date(row.expiresAt));

  const delivery = reportDelivery();
  const result = await delivery.deliver({
    channel: input.channel,
    areaLabel: subject.areaLabel,
    radiusLabel: `${subject.radiusM / 1000} km`,
    verdictLabel: subject.scoreVerdict
      ? subject.scoreVerdict[0]!.toUpperCase() + subject.scoreVerdict.slice(1)
      : null,
    scoreTotal: subject.scoreTotal === null ? null : Number(subject.scoreTotal),
    basisLabel: subject.scoreBasis === "desk_only" ? "Desk assessment, no site survey" : null,
    url: link.url,
    preparedBy: input.user.displayName,
    recipientName,
    expiresOnLabel: link.expiresOnLabel,
    caption: input.caption,
  });

  await recordShareRows({
    reportId: row.id,
    scanId: row.scanId,
    userId: input.user.userId,
    channel: input.channel,
    recipientName,
    linkExpiresAt: new Date(row.expiresAt),
  });

  return {
    // `whatsappUrl` is kept as the field name the screens already read. It is
    // null under a delivery implementation that sends for itself, and the
    // screens branch on `mode` rather than on the URL being present.
    whatsappUrl: result.handoffUrl,
    mode: result.mode,
    deliveryNote: deliveryNote(result.mode),
    message: result.message,
    link,
    recipientName,
  };
}

/* -------------------------------------------------- comparison reports */

/**
 * Start a comparison report over two or more scans.
 *
 * `scanIds[0]` becomes the row's `scan_id` — the anchor that keeps the foreign
 * key, the ownership check and the dashboard join working — and the whole list
 * is stored in `subject_scan_ids` so the document can be rebuilt exactly.
 */
export async function startComparisonGeneration(
  author: ScoutProfile,
  scanIds: readonly string[],
): Promise<ReportGenerationRow | null> {
  const readable = await getCompareSubjects(author, scanIds);
  if (readable.length < 2) return null;

  const anchor = readable[0]!.scanId;
  const row = await createGenerationRow({
    scanId: anchor,
    userId: author.userId,
    kind: "comparison",
    subjectScanIds: readable.map((s) => s.scanId),
    title: `${readable.map((s) => s.areaLabel).join(" vs ")} — Site Scout comparison`,
    version: await nextReportVersion(anchor),
  });

  return row ? toRow(row) : null;
}

export async function runComparisonGeneration(
  author: ScoutProfile,
  reportId: string,
): Promise<GenerationOutcome> {
  const existing = await findReportRow(reportId);
  if (!existing) return { ok: false, reportId, error: "The report row no longer exists." };

  try {
    const generatedAt = new Date();
    // Drizzle typed this jsonb column as `string[] | null`; Prisma types every
    // jsonb column as `JsonValue`. The column is only ever written by
    // `createGenerationRow` from a `string[]`, so the shape is unchanged.
    const subjectScanIds = (existing.subjectScanIds as string[] | null) ?? [existing.scanId];
    const subjects = await getCompareSubjects(author, subjectScanIds);
    if (subjects.length < 2) {
      throw new Error("A comparison needs at least two scans the signed-in user can read.");
    }

    const comparison = buildComparison(
      subjects,
      CATEGORIES.map((c) => ({ id: c.id, label: c.label, side: c.side })),
    );
    const doc = buildComparisonDocument(comparison, {
      preparedBy: author.displayName,
      customerName: null,
      generatedAt: generatedAt.toISOString(),
      version: existing.version,
    });

    const brand = reportBrand();
    const pdf = await renderPdf(await renderComparisonHtml(doc), {
      headerText: `${subjects.map((s) => s.areaLabel).join(" · ")} — Site Scout comparison v${existing.version}`,
      footerText: [brand.legalName, brand.attribution, "Preliminary desk survey — not financial, investment, legal or planning advice"]
        .filter(Boolean)
        .join(" · "),
    });

    const stored = await reportStorage().put(reportId, pdf.bytes);
    const expiresAt = expiryFromNow(generatedAt, linkTtlDays());

    await markReportGenerated(reportId, {
      blobKey: stored.key,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      pageCount: pdf.pageCount,
      engine: pdf.engine,
      generatedAt,
      expiresAt,
    });

    return { ok: true, reportId };
  } catch (error) {
    const message = failureMessage(error, "The comparison report could not be generated");
    await markReportFailed(reportId, message);
    return { ok: false, reportId, error: message };
  }
}
