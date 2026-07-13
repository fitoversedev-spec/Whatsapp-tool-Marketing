import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFields } from "@/lib/contacts";
import ContactsClient from "./ContactsClient";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { tag?: string };
}) {
  await requireUser();

  // Optional ?tag=<id> filter, set when clicking a tag count on /tags or
  // selecting a tag in the in-page filter. Empty value = no filter.
  const tagFilter = searchParams.tag?.trim() || null;

  const where = tagFilter
    ? { tags: { some: { tagId: tagFilter } } }
    : {};

  // These four queries are mutually independent, so run them concurrently
  // instead of in a sequential waterfall (was 4 serial round-trips → now 1).
  const [contacts, total, allForMeta, allTags] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { tags: { include: { tag: true } } },
    }),
    prisma.contact.count({ where }),
    // Collect distinct field keys for the column headers + filter UI
    prisma.contact.findMany({ select: { fields: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);

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
        tagIds: c.tags.map((ct) => ct.tag.id),
        tags: c.tags.map((ct) => ({ id: ct.tag.id, name: ct.tag.name, color: ct.tag.color })),
      }))}
      total={total}
      fieldKeys={Array.from(fieldKeys).sort()}
      allTags={allTags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
      activeTagFilter={tagFilter}
    />
  );
}
