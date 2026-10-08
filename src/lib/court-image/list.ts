import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Columns the court-design lists show. `layout` (the whole canvas JSON) is left
// out; the sports chips are read from it in SQL by sportsByCourtImageId().
export const COURT_IMAGE_LIST_SELECT = {
  id: true,
  number: true,
  customerName: true,
  imageUrl: true,
  caption: true,
  status: true,
  conversationId: true,
  contactPhone: true,
  sentAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.CourtImageSelect;

// Same result the old per-page copies gave: anything unreadable -> [].
function parseSports(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sportsFromLayout(layoutJson: string): string[] {
  try {
    const parsed = JSON.parse(layoutJson);
    return Array.isArray(parsed?.sports) ? parsed.sports : [];
  } catch {
    return [];
  }
}

// layout.sports for each id, read in SQL so the large layout text never leaves
// the database. The regex guard keeps non-object layouts from reaching the
// jsonb cast. If the query still fails (e.g. malformed JSON in one row), fall
// back to loading those layouts and parsing in JS, one row at a time.
export async function sportsByCourtImageId(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  try {
    const rows = await prisma.$queryRaw<{ id: string; sports: string | null }[]>`
      SELECT id,
        CASE WHEN layout ~ '^[[:space:]]*[{]' THEN (layout::jsonb -> 'sports')::text ELSE NULL END AS sports
      FROM court_images
      WHERE id IN (${Prisma.join(ids)})`;
    for (const r of rows) out.set(r.id, parseSports(r.sports));
  } catch {
    const rows = await prisma.courtImage.findMany({
      where: { id: { in: ids } },
      select: { id: true, layout: true },
    });
    for (const r of rows) out.set(r.id, sportsFromLayout(r.layout));
  }
  return out;
}
