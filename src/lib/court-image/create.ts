import { prisma } from "@/lib/prisma";
import { buildCourtImageNumber } from "./schema";

// Find the next sequential number for a given calendar year by parsing
// the highest existing FIT-CIM-YYYY-NNN row. Returns 1 if no rows exist
// yet that year.
async function nextCourtImageSeq(year: number): Promise<number> {
  const prefix = `FIT-CIM-${year}-`;
  const latest = await prisma.courtImage.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  if (!latest) return 1;
  const seqStr = latest.number.slice(prefix.length);
  const seq = parseInt(seqStr, 10);
  if (!Number.isFinite(seq)) return 1;
  return seq + 1;
}

export type NewCourtImage = {
  customerName: string;
  /** The layout, already serialised. */
  layout: string;
  imageUrl?: string | null;
  image2dUrl?: string | null;
  image3dUrl?: string | null;
  video3dUrl?: string | null;
  caption?: string | null;
  conversationId?: string | null;
  contactPhone?: string | null;
  createdByUserId: string;
  dealId?: string | null;
  accountContactId?: string | null;
};

// Create a draft design with the next FIT-CIM-YYYY-NNN number. Derives the
// number from the highest existing row and retries on the unique-constraint
// race (count()+1 collides as soon as any row gets deleted, which is exactly
// the symptom prod was hitting). Null if it still collides after the retries.
// Shared by POST /api/court-images and the AI agent's create_design_draft.
export async function createCourtImageRow(data: NewCourtImage) {
  const year = new Date().getFullYear();
  let nextSeq = await nextCourtImageSeq(year);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await prisma.courtImage.create({
        data: {
          number: buildCourtImageNumber(year, nextSeq - 1),
          customerName: data.customerName,
          layout: data.layout,
          imageUrl: data.imageUrl ?? null,
          image2dUrl: data.image2dUrl ?? null,
          image3dUrl: data.image3dUrl ?? null,
          video3dUrl: data.video3dUrl ?? null,
          caption: data.caption ?? null,
          conversationId: data.conversationId ?? null,
          contactPhone: data.contactPhone ?? null,
          createdByUserId: data.createdByUserId,
          status: "draft",
          dealId: data.dealId ?? null,
          accountContactId: data.accountContactId ?? null,
        },
      });
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      nextSeq += 1;
    }
  }
  console.error("[court-images] number collision after retries", lastError);
  return null;
}
