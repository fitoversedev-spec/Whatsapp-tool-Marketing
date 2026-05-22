import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFields } from "@/lib/contacts";
import ContactsClient from "./ContactsClient";

export default async function ContactsPage() {
  await requireUser();

  const contacts = await prisma.contact.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const total = await prisma.contact.count();

  // Collect distinct field keys for the column headers + filter UI
  const allForMeta = await prisma.contact.findMany({ select: { fields: true } });
  const fieldKeys = new Set<string>();
  for (const c of allForMeta) {
    for (const k of Object.keys(parseFields(c.fields))) fieldKeys.add(k);
  }

  return (
    <ContactsClient
      initialContacts={contacts.map((c) => ({
        id: c.id,
        phone: c.phone,
        name: c.name,
        allowCampaign: c.allowCampaign,
        fields: parseFields(c.fields),
        createdAt: c.createdAt.toISOString(),
      }))}
      total={total}
      fieldKeys={Array.from(fieldKeys).sort()}
    />
  );
}
