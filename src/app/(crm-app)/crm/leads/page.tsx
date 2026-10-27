import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeeAllCustomers, customerAccess } from "@/lib/rbac";
import { listLeadStages } from "@/lib/crm/leadStages";
import { getMetaLeadLabels } from "@/lib/meta-ads/queries";
import LeadsClient from "./LeadsClient";

export default async function LeadsPage({ searchParams }: { searchParams: { label?: string } }) {
  const user = await requireUser();
  const seesAll = canSeeAllCustomers(user.role);

  // Shared label catalogue (same one ad leads and website leads use). The
  // "label" URL param filters server-side, so it narrows the 300 newest leads
  // below rather than just the rows already loaded — and an id that isn't in
  // the catalogue (stale link, deleted label) is ignored instead of emptying
  // the list.
  const labelCatalog = await getMetaLeadLabels();
  const labelParam = typeof searchParams.label === "string" ? searchParams.label : "";
  const labelFilter = labelCatalog.some((l) => l.id === labelParam) ? labelParam : "";

  // Same owner-scoping the Contacts list uses — ownership lives on the parent
  // Account, so sales sees only leads under accounts they own; admins,
  // managers and management see all.
  const [leads, leadStages, reps] = await Promise.all([
    prisma.accountContact.findMany({
      where: {
        deletedAt: null,
        pipelineStage: "LEAD",
        ...(seesAll ? {} : { account: { ownerUserId: user.id } }),
        ...(labelFilter ? { labels: { some: { labelId: labelFilter } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        account: { select: { id: true, name: true, city: true, ownerUserId: true, owner: { select: { name: true } } } },
        leadSource: { select: { name: true } },
        // "Converted" is derived, never stored — a lead is converted once it
        // already backs a Deal as the primary contact.
        dealsAsPrimary: { where: { deletedAt: null }, select: { id: true } },
        labels: {
          select: { label: { select: { id: true, name: true, color: true } } },
          orderBy: { label: { name: "asc" } },
        },
      },
    }),
    listLeadStages(),
    // Rep filter options — only for those who see every rep's leads.
    seesAll
      ? prisma.user.findMany({
          where: { deletedAt: null, isActive: true, approvalStatus: "approved", role: { not: "ai_agent" } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const reminders = await nextRemindersByLead(leads.map((l) => ({ id: l.id, dealIds: l.dealsAsPrimary.map((d) => d.id) })));

  return (
    <LeadsClient
      leadStages={leadStages}
      reps={reps}
      labelCatalog={labelCatalog}
      labelFilter={labelFilter}
      leads={leads.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        accountId: l.account.id,
        accountName: l.account.name,
        location: l.account.city ?? null,
        leadSource: l.leadSource?.name ?? null,
        converted: l.dealsAsPrimary.length > 0,
        labels: l.labels.map((x) => x.label),
        leadStageId: l.leadStageId,
        ownerUserId: l.account.ownerUserId,
        ownerName: l.account.owner?.name?.trim() || null,
        canEdit: customerAccess(user, l.account.ownerUserId).canEdit,
        nextReminder: reminders.get(l.id) ?? null,
      }))}
    />
  );
}

// Each lead's soonest pending reminder (and how many are pending) — counting
// reminders set on the contact itself, on its deals, on its WhatsApp chat and
// on the Meta ad lead it came from, whoever owns them.
async function nextRemindersByLead(leads: { id: string; dealIds: string[] }[]) {
  const result = new Map<string, { message: string; dueAt: string; count: number }>();
  if (!leads.length) return result;
  const leadIds = leads.map((l) => l.id);

  const [marketingContacts, metaLeads] = await Promise.all([
    prisma.contact.findMany({ where: { accountContactId: { in: leadIds } }, select: { accountContactId: true, phone: true } }),
    prisma.metaLead.findMany({ where: { accountContactId: { in: leadIds } }, select: { id: true, accountContactId: true } }),
  ]);
  const conversations = marketingContacts.length
    ? await prisma.conversation.findMany({ where: { contactPhone: { in: marketingContacts.map((c) => c.phone) } }, select: { id: true, contactPhone: true } })
    : [];

  // Anchor id → lead id, for each kind of anchor a reminder can have.
  const byDeal = new Map(leads.flatMap((l) => l.dealIds.map((d) => [d, l.id] as const)));
  const byMetaLead = new Map(metaLeads.map((m) => [m.id, m.accountContactId as string]));
  const leadByPhone = new Map(marketingContacts.map((c) => [c.phone, c.accountContactId as string]));
  const byConversation = new Map(conversations.map((c) => [c.id, leadByPhone.get(c.contactPhone) as string]));

  const reminders = await prisma.reminder.findMany({
    where: {
      completedAt: null,
      OR: [
        { accountContactId: { in: leadIds } },
        ...(byDeal.size ? [{ dealId: { in: Array.from(byDeal.keys()) } }] : []),
        ...(byMetaLead.size ? [{ metaLeadId: { in: Array.from(byMetaLead.keys()) } }] : []),
        ...(byConversation.size ? [{ conversationId: { in: Array.from(byConversation.keys()) } }] : []),
      ],
    },
    orderBy: { dueAt: "asc" },
    select: { id: true, message: true, dueAt: true, accountContactId: true, dealId: true, metaLeadId: true, conversationId: true },
  });

  const seen = new Set<string>();
  for (const r of reminders) {
    const leadId =
      (r.accountContactId && leadIds.includes(r.accountContactId) ? r.accountContactId : null) ??
      (r.dealId ? byDeal.get(r.dealId) : undefined) ??
      (r.metaLeadId ? byMetaLead.get(r.metaLeadId) : undefined) ??
      (r.conversationId ? byConversation.get(r.conversationId) : undefined);
    if (!leadId || seen.has(`${leadId}:${r.id}`)) continue;
    seen.add(`${leadId}:${r.id}`);
    const cur = result.get(leadId);
    if (cur) cur.count += 1;
    else result.set(leadId, { message: r.message, dueAt: r.dueAt.toISOString(), count: 1 });
  }
  return result;
}
