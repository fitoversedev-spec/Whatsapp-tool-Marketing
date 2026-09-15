import "server-only";

import { Prisma, prisma, type Database } from "@/lib/scout/db";

export interface ExcludedPlaceRow {
  readonly id: string;
  readonly ownerId: string;
  readonly googlePlaceId: string;
  readonly categoryId: string;
  readonly scanId: string;
  readonly locked: boolean;
  readonly excludedAt: Date;
}

export async function excludePlace(
  ownerId: string,
  googlePlaceId: string,
  categoryId: string,
  scanId: string,
  database: Database = prisma,
): Promise<ExcludedPlaceRow> {
  const [row] = await database.$queryRaw<ExcludedPlaceRow[]>(Prisma.sql`
    INSERT INTO excluded_places (owner_id, google_place_id, category_id, scan_id)
    VALUES (${ownerId}, ${googlePlaceId}, ${categoryId}, ${scanId}::uuid)
    ON CONFLICT (owner_id, google_place_id, category_id) DO UPDATE
      SET scan_id = EXCLUDED.scan_id,
          locked = false,
          excluded_at = now()
    RETURNING id, owner_id AS "ownerId", google_place_id AS "googlePlaceId",
              category_id AS "categoryId", scan_id AS "scanId",
              locked, excluded_at AS "excludedAt"
  `);
  return row;
}

export async function undoExclusion(
  exclusionId: string,
  ownerId: string,
  database: Database = prisma,
): Promise<boolean> {
  const result = await database.$executeRaw(Prisma.sql`
    DELETE FROM excluded_places
    WHERE id = ${exclusionId}::uuid
      AND owner_id = ${ownerId}
      AND locked = false
  `);
  return result > 0;
}

export async function getExclusionsForOwner(
  ownerId: string,
  database: Database = prisma,
): Promise<ExcludedPlaceRow[]> {
  return database.$queryRaw<ExcludedPlaceRow[]>(Prisma.sql`
    SELECT id, owner_id AS "ownerId", google_place_id AS "googlePlaceId",
           category_id AS "categoryId", scan_id AS "scanId",
           locked, excluded_at AS "excludedAt"
    FROM excluded_places
    WHERE owner_id = ${ownerId}
    ORDER BY excluded_at DESC
  `);
}

export async function getExcludedPlaceIdsForOwner(
  ownerId: string,
  database: Database = prisma,
): Promise<Set<string>> {
  const rows = await database.$queryRaw<Array<{ googlePlaceId: string }>>(Prisma.sql`
    SELECT DISTINCT google_place_id AS "googlePlaceId"
    FROM excluded_places
    WHERE owner_id = ${ownerId}
  `);
  return new Set(rows.map((r) => r.googlePlaceId));
}

export async function lockExclusionsForScan(
  scanId: string,
  database: Database = prisma,
): Promise<number> {
  return database.$executeRaw(Prisma.sql`
    UPDATE excluded_places
    SET locked = true
    WHERE scan_id = ${scanId}::uuid
      AND locked = false
  `);
}
