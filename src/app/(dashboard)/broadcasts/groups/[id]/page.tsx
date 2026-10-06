import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFields } from "@/lib/contacts";
import { canEditGroup } from "@/lib/broadcast-groups";
import GroupDetailClient, { type GroupMemberRow } from "./GroupDetailClient";

// One broadcast group: who's in it and whether each person will actually get
// a broadcast (campaigns allowed, not opted out). Groups are shared, so every
// signed-in user can open any group; removing members, renaming and deleting
// are for its maker or an admin.
export default async function BroadcastGroupPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const group = await prisma.broadcastGroup.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      createdByUserId: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      members: {
        orderBy: { addedAt: "desc" },
        select: {
          addedAt: true,
          addedByUserId: true,
          contact: { select: { id: true, name: true, phone: true, fields: true, allowCampaign: true } },
        },
      },
    },
  });
  if (!group) notFound();

  const phones = group.members.map((m) => m.contact.phone);
  const adderIds = [...new Set(group.members.map((m) => m.addedByUserId).filter((x): x is string => !!x))];
  const [optOuts, adders] = await Promise.all([
    phones.length ? prisma.optOut.findMany({ where: { phoneE164: { in: phones } }, select: { phoneE164: true } }) : [],
    adderIds.length ? prisma.user.findMany({ where: { id: { in: adderIds } }, select: { id: true, name: true } }) : [],
  ]);
  const optedOut = new Set(optOuts.map((o) => o.phoneE164));
  const adderName = new Map(adders.map((u) => [u.id, u.name]));

  const members: GroupMemberRow[] = group.members.map((m) => {
    const f = parseFields(m.contact.fields);
    const city = String(f["Attribute 1"] ?? f.location ?? f.Location ?? f.city ?? f.City ?? "").trim();
    return {
      contactId: m.contact.id,
      name: m.contact.name,
      phone: m.contact.phone,
      city: city || null,
      status: optedOut.has(m.contact.phone) ? "opted_out" : m.contact.allowCampaign ? "ok" : "blocked",
      addedAt: m.addedAt.toISOString(),
      addedByName: m.addedByUserId ? adderName.get(m.addedByUserId) ?? null : null,
    };
  });

  return (
    <GroupDetailClient
      group={{
        id: group.id,
        name: group.name,
        createdByName: group.createdBy.name,
        createdAt: group.createdAt.toISOString(),
      }}
      members={members}
      canEdit={canEditGroup(user, group)}
    />
  );
}
