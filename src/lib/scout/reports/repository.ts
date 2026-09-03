import "server-only";

import type { Report } from "@prisma/client";

import { Prisma, prisma } from "@/lib/scout/db";

import { defaultBlockState, sanitiseBlockState, type ReportBlockState } from "./blocks";

export interface ReportDraft {
  readonly id: string;
  readonly scanId: string;
  readonly title: string | null;
  readonly includedBlocks: ReportBlockState;
  readonly fieldNotes: string;
  readonly status: string;
  readonly channel: "whatsapp" | "pdf" | "email" | null;
  readonly updatedAt: string;
}

/**
 * The draft for a scan, or `null` when the studio has never been opened.
 *
 * One scan can accumulate several reports over time — a v1 sent in August and a
 * revised one in October. The studio always edits the most recent draft, and
 * creates one only when the surveyor changes something. Opening the screen
 * should not write a row.
 */
export async function getReportDraft(scanId: string): Promise<ReportDraft | null> {
  const row = await prisma.report.findFirst({
    where: { scanId },
    orderBy: { createdAt: "desc" },
  });

  if (!row) return null;
  return {
    id: row.id,
    scanId: row.scanId,
    title: row.title,
    includedBlocks: sanitiseBlockState(row.includedBlocks),
    fieldNotes: row.fieldNotes ?? "",
    status: row.status,
    channel: row.channel,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface SaveReportDraftInput {
  readonly scanId: string;
  readonly userId: string;
  readonly includedBlocks: unknown;
  readonly fieldNotes: string;
  readonly title?: string | null;
  readonly scoreModelVersion?: string | null;
}

/**
 * Create or update the draft.
 *
 * Field notes are written to **both** `reports.field_notes` and
 * `scans.field_notes`. The scan's copy is what the mobile surveyor screen and
 * the score input read; the report's copy is what that particular document
 * printed, and must not change when somebody edits the scan a month later. Two
 * fields, two different questions.
 */
export async function saveReportDraft(input: SaveReportDraftInput): Promise<ReportDraft> {
  const blocks = sanitiseBlockState(input.includedBlocks);
  const notes = input.fieldNotes.slice(0, 4000);

  const existing = await prisma.report.findFirst({
    where: { scanId: input.scanId, status: "draft" },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });

  if (existing) {
    /**
     * Raw, so `updated_at` keeps taking the database's `now()` rather than this
     * process's clock — the same reason the other timestamp writes below are
     * raw. The value is read straight back into `ReportDraft.updatedAt`, and a
     * skewed app clock would make a freshly saved draft look stale.
     */
    const title =
      input.title === undefined ? Prisma.empty : Prisma.sql`, title = ${input.title}`;
    const modelVersion =
      input.scoreModelVersion === undefined
        ? Prisma.empty
        : Prisma.sql`, score_model_version = ${input.scoreModelVersion}`;

    await prisma.$executeRaw(Prisma.sql`
      UPDATE reports SET
        included_blocks = ${JSON.stringify(blocks)}::jsonb,
        field_notes = ${notes}${title}${modelVersion},
        updated_at = now()
      WHERE id = ${existing.id}::uuid
    `);
  } else {
    await prisma.report.create({
      data: {
        scanId: input.scanId,
        createdBy: input.userId,
        title: input.title ?? null,
        includedBlocks: blocks as Prisma.InputJsonValue,
        fieldNotes: notes,
        scoreModelVersion: input.scoreModelVersion ?? null,
        status: "draft",
      },
    });
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE scans SET field_notes = ${notes}, updated_at = now() WHERE id = ${input.scanId}::uuid
  `);

  const saved = await getReportDraft(input.scanId);
  if (saved) return saved;

  // Unreachable in practice; a typed fallback beats a non-null assertion.
  return {
    id: "",
    scanId: input.scanId,
    title: input.title ?? null,
    includedBlocks: defaultBlockState(),
    fieldNotes: notes,
    status: "draft",
    channel: null,
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------------ */
/* Below here is Phase 6: generation, sharing and retrieval.                 */
/*                                                                          */
/* ## Why it is all in this one file                                        */
/*                                                                          */
/* Site Scout is being folded into a host application that uses Prisma.      */
/* Every module issuing a Drizzle query is a module somebody ports by hand,  */
/* so the report feature keeps its database access in exactly two places:    */
/* this file, and `storage.ts` — and `storage.ts` is the storage driver of   */
/* last resort, which a host with object storage replaces wholesale rather   */
/* than ports.                                                              */
/*                                                                          */
/* `data.ts`, `generate.ts` and the routes call functions from here and      */
/* never touch `db` themselves. The functions are shaped as whole operations */
/* — "mark this generated", "record this share" — rather than as query       */
/* helpers, so a port rewrites bodies without rethinking the boundary.       */
/* ------------------------------------------------------------------------ */

/** The scan columns the report needs that `getScanResult` does not carry. */
export interface ReportScanFacts {
  readonly address: string | null;
  readonly customerName: string | null;
  readonly scoreBreakdown: Record<string, unknown> | null;
  readonly scannedAt: Date | null;
  readonly surveyorInputs: Record<string, number> | null;
  readonly fieldNotes: string | null;
  readonly sweep: Record<string, unknown> | null;
}

export async function getReportScanFacts(scanId: string): Promise<ReportScanFacts | null> {
  const row = await prisma.scan.findUnique({
    where: { id: scanId },
    select: {
      address: true,
      customerName: true,
      scoreBreakdown: true,
      scannedAt: true,
      surveyorInputs: true,
      fieldNotes: true,
      sweep: true,
    },
  });
  if (!row) return null;
  return {
    address: row.address,
    customerName: row.customerName,
    scoreBreakdown: row.scoreBreakdown as Record<string, unknown> | null,
    scannedAt: row.scannedAt,
    surveyorInputs: row.surveyorInputs as Record<string, number> | null,
    fieldNotes: row.fieldNotes,
    sweep: row.sweep as Record<string, unknown> | null,
  };
}

export interface ComplaintThemeRow {
  readonly googlePlaceId: string;
  readonly venueName: string;
  readonly theme: string;
  readonly sentiment: string | null;
  readonly mentionCount: number;
  readonly evidence: unknown;
}

/**
 * Every theme row for a set of Google place ids, marker rows included.
 *
 * The marker is returned rather than filtered out here because the caller needs
 * it to tell "analysed, nothing found" from "not analysed yet" — two findings
 * that read very differently to a land owner, and otherwise the same empty list.
 */
export async function getComplaintThemeRows(
  googlePlaceIds: readonly string[],
): Promise<ComplaintThemeRow[]> {
  if (googlePlaceIds.length === 0) return [];
  // Was an INNER JOIN on `places`; `review_themes.place_id` is nullable, and
  // filtering on the relation reproduces the join's "only rows with a place".
  const rows = await prisma.reviewTheme.findMany({
    where: { place: { placeId: { in: [...googlePlaceIds] } } },
    select: {
      theme: true,
      sentiment: true,
      mentionCount: true,
      evidence: true,
      place: { select: { placeId: true, name: true } },
    },
  });
  return rows.map((r) => ({
    googlePlaceId: r.place!.placeId,
    venueName: r.place!.name,
    theme: r.theme,
    sentiment: r.sentiment,
    mentionCount: r.mentionCount,
    evidence: r.evidence,
  }));
}

/* ------------------------------------------------------ generation rows */

export type ReportRow = Report;

/** Statuses meaning "a generation was attempted", as opposed to a draft. */
const GENERATION_STATUSES = new Set(["generating", "generated", "delivered", "failed"]);

export async function findLatestGenerationRow(scanId: string): Promise<ReportRow | null> {
  const rows = await prisma.report.findMany({
    where: { scanId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return rows.find((row) => GENERATION_STATUSES.has(row.status)) ?? null;
}

export async function findReportRow(reportId: string): Promise<ReportRow | null> {
  return prisma.report.findUnique({ where: { id: reportId } });
}

export async function nextReportVersion(scanId: string): Promise<number> {
  const row = await prisma.report.findFirst({
    where: { scanId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (row?.version ?? 0) + 1;
}

export interface CreateGenerationInput {
  readonly scanId: string;
  readonly userId: string;
  readonly kind: "scan" | "comparison";
  readonly title: string;
  readonly version: number;
  readonly includedBlocks?: Record<string, boolean> | null;
  readonly fieldNotes?: string | null;
  readonly scoreModelVersion?: string | null;
  readonly subjectScanIds?: string[] | null;
}

export async function createGenerationRow(input: CreateGenerationInput): Promise<ReportRow | null> {
  return prisma.report.create({
    data: {
      scanId: input.scanId,
      createdBy: input.userId,
      kind: input.kind,
      title: input.title,
      version: input.version,
      // `Prisma.DbNull` writes SQL NULL. A bare `null` on a `Json?` column is
      // ambiguous to Prisma, and `Prisma.JsonNull` would store the JSON value
      // `null` — which reads back as a value rather than as absent.
      includedBlocks: (input.includedBlocks ?? Prisma.DbNull) as Prisma.InputJsonValue,
      fieldNotes: input.fieldNotes ?? null,
      scoreModelVersion: input.scoreModelVersion ?? null,
      subjectScanIds: (input.subjectScanIds ?? Prisma.DbNull) as Prisma.InputJsonValue,
      status: "generating",
    },
  });
}

export interface GeneratedFacts {
  readonly blobKey: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly pageCount: number | null;
  readonly engine: string;
  readonly generatedAt: Date;
  readonly expiresAt: Date;
}

export async function markReportGenerated(
  reportId: string,
  facts: GeneratedFacts,
): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE reports SET
      status = 'generated'::report_status,
      pdf_blob_key = ${facts.blobKey},
      pdf_bytes = ${facts.byteSize},
      pdf_sha256 = ${facts.sha256},
      page_count = ${facts.pageCount},
      pdf_engine = ${facts.engine},
      generated_at = ${facts.generatedAt},
      expires_at = ${facts.expiresAt},
      error = NULL,
      updated_at = now()
    WHERE id = ${reportId}::uuid
  `);
}

export async function markReportFailed(reportId: string, message: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE reports SET
      status = 'failed'::report_status,
      error = ${message.slice(0, 2000)},
      updated_at = now()
    WHERE id = ${reportId}::uuid
  `);
}

/* ---------------------------------------------------------------- shares */

/** What the share message needs to know about the scan behind a report. */
export interface ShareSubject {
  readonly ownerId: string;
  readonly areaLabel: string;
  readonly radiusM: number;
  readonly scoreTotal: string | null;
  readonly scoreVerdict: string | null;
  readonly scoreBasis: string | null;
}

export async function getShareSubject(scanId: string): Promise<ShareSubject | null> {
  const row = await prisma.scan.findUnique({
    where: { id: scanId },
    select: {
      ownerId: true,
      areaLabel: true,
      radiusM: true,
      scoreTotal: true,
      scoreVerdict: true,
      scoreBasis: true,
    },
  });
  if (!row) return null;
  return {
    ...row,
    // `numeric(5,2)` arrives as a `Decimal` under Prisma and as a string under
    // Drizzle. `toFixed(2)` reproduces the string Postgres used to hand over,
    // trailing zero and all, so nothing downstream sees a different value.
    scoreTotal: row.scoreTotal === null ? null : row.scoreTotal.toFixed(2),
  };
}

export interface RecordShareInput {
  readonly reportId: string;
  readonly scanId: string;
  readonly userId: string;
  readonly channel: "whatsapp" | "pdf" | "email";
  readonly recipientName: string | null;
  readonly linkExpiresAt: Date;
}

/**
 * Log the hand-over, mark the report delivered, and flip the scan's status.
 *
 * One function because the three writes are one fact. A share row without the
 * scan status change leaves D1 reading "Scan only" for a report that went out;
 * the status change without the share row loses who it went to.
 */
export async function recordShareRows(input: RecordShareInput): Promise<void> {
  await prisma.reportShare.create({
    data: {
      reportId: input.reportId,
      scanId: input.scanId,
      sharedBy: input.userId,
      channel: input.channel,
      recipientName: input.recipientName,
      linkExpiresAt: input.linkExpiresAt,
    },
  });

  await prisma.$executeRaw(Prisma.sql`
    UPDATE reports SET
      status = 'delivered'::report_status,
      channel = ${input.channel}::report_channel,
      sent_to = ${input.recipientName},
      sent_at = now(),
      updated_at = now()
    WHERE id = ${input.reportId}::uuid
  `);

  await prisma.$executeRaw(Prisma.sql`
    UPDATE scans SET status = 'report_sent'::scan_status, updated_at = now()
    WHERE id = ${input.scanId}::uuid
  `);
}

/* ------------------------------------------------------- the public link */

/** The little the signed-link route needs, and nothing more. */
export interface PublicReportRow {
  readonly id: string;
  readonly status: string;
  readonly version: number;
  readonly expiresAt: Date | null;
  readonly areaLabel: string;
}

export async function getPublicReportRow(reportId: string): Promise<PublicReportRow | null> {
  const row = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      status: true,
      version: true,
      expiresAt: true,
      scan: { select: { areaLabel: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    version: row.version,
    expiresAt: row.expiresAt,
    areaLabel: row.scan.areaLabel,
  };
}
