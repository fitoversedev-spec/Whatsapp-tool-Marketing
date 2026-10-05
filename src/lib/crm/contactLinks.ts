// Which contacts a quotation / court design shows on — the same rule the
// contact page lists them by: the deal's primary contact, or (quotations only)
// a contact whose phone is exactly the quotation's. Used to record deletions
// on those contacts' Timelines.
import { prisma } from "@/lib/prisma";
import { logContactEvents, type ContactEventKind } from "./contactEvents";

async function contactIdsFor(dealId: string | null, phone: string | null): Promise<string[]> {
  const ids = new Set<string>();
  if (dealId) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { primaryContactId: true } });
    if (deal?.primaryContactId) ids.add(deal.primaryContactId);
  }
  if (phone) {
    const byPhone = await prisma.accountContact.findMany({ where: { phone, deletedAt: null }, select: { id: true } });
    for (const c of byPhone) ids.add(c.id);
  }
  return Array.from(ids);
}

export async function logDocumentDeleted(
  doc: { kind: "quotation" | "design"; number: string; dealId: string | null; contactPhone: string | null; createdAt: Date },
  actorUserId: string,
): Promise<void> {
  try {
    const contactIds = await contactIdsFor(doc.dealId, doc.kind === "quotation" ? doc.contactPhone : null);
    const kind: ContactEventKind = doc.kind === "quotation" ? "quotation_deleted" : "design_deleted";
    const created = doc.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
    await logContactEvents(
      contactIds.map((contactId) => ({
        contactId,
        actorUserId,
        kind,
        summary: `${doc.kind === "quotation" ? "Quotation" : "Court design"} deleted — ${doc.number}`,
        detail: `Created ${created}`,
      })),
    );
  } catch (err) {
    console.error("[contact-events] document delete log failed", err);
  }
}
