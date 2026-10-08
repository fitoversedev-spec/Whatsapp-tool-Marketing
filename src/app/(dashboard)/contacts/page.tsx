import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listContacts, distinctFieldKeys } from "@/lib/contacts-query";
import ContactsClient from "./ContactsClient";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { tag?: string };
}) {
  const user = await requireUser();

  // Optional ?tag=<id> filter, set when clicking a tag count on /tags or
  // selecting a tag in the in-page filter. Empty value = no filter.
  const tagFilter = searchParams.tag?.trim() || null;

  // Independent queries, run together. Page 1 carries its own total; the whole
  // pool is only counted separately when a tag narrows the list.
  const [list, tagPoolTotal, fieldKeys, allTags] = await Promise.all([
    listContacts({ tag: tagFilter }, 1),
    tagFilter ? prisma.contact.count() : Promise.resolve(null),
    // Distinct field keys for the column headers + filter UI; the page still
    // renders without them if this fails.
    distinctFieldKeys().catch((): string[] => []),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <ContactsClient
      initialContacts={list.contacts}
      total={list.total}
      poolTotal={tagPoolTotal ?? list.total}
      fieldKeys={fieldKeys}
      allTags={allTags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
      activeTagFilter={tagFilter}
      isAdmin={user.role === "admin"}
    />
  );
}
