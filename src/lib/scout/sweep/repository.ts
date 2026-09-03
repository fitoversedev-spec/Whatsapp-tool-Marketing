import "server-only";

import { Prisma, prisma, type Database } from "@/lib/scout/db";

import { packSweepDocument, parseSweepDocument, type SweepDocument } from "./grid";

/** The stored sweep for a scan, or `null` when nobody has swept it. */
export async function getSweep(
  scanId: string,
  database: Database = prisma,
): Promise<SweepDocument | null> {
  const row = await database.scan.findUnique({
    where: { id: scanId },
    select: { sweep: true },
  });

  return parseSweepDocument(row?.sweep ?? null);
}

/**
 * Replace the stored sweep.
 *
 * Whole-document replacement rather than per-cell upsert: a split turns one
 * cell into four and a resize replans the lot, so "what changed" is rarely a
 * single row. One UPDATE also means a reader never sees a half-applied grid.
 *
 * Raw SQL rather than `scan.update` only so `updated_at` keeps taking the
 * database's `now()`, as it did under Drizzle, instead of this process's clock.
 */
export async function saveSweep(
  scanId: string,
  doc: SweepDocument,
  database: Database = prisma,
): Promise<SweepDocument> {
  const packed = packSweepDocument(doc, new Date().toISOString());
  await database.$executeRaw(
    Prisma.sql`UPDATE scans SET sweep = ${JSON.stringify(packed)}::jsonb, updated_at = now() WHERE id = ${scanId}::uuid`,
  );
  return packed;
}
