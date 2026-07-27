// The single "can this user see/act on this thread" chokepoint every chat
// route calls first — mirrors loadAuthorized in the account-contacts
// attachments route. Option B (restricted): a non-admin sees a thread only if
// they OWN the anchored record, hold a ChatParticipant row (TAGGED now,
// COVERING in Phase 2), or are admin. Get-or-create aware: resolves (and, on
// first authorized access, creates) the one thread per anchored record.
import { prisma } from "@/lib/prisma";
import { isAdmin, type Role } from "@/lib/rbac";

export type ChatAnchorType = "account_contact" | "deal" | "team" | "dm";
type Actor = { id: string; role: Role };

export type ThreadRef = { id: string; accountContactId: string | null; dealId: string | null };
export type LoadThreadResult = { error: string; status: number } | { thread: ThreadRef; owns: boolean; admin: boolean; created: boolean };

// Does this user OWN the anchored record, and does the record still exist?
// Unowned records (ownerUserId === null) return owns:false — Option B is
// restrictive, so an unowned record's thread is reachable only by admin or an
// explicit participant, never by "everyone" the way some legacy guards leak.
async function resolveAnchor(
  anchorType: ChatAnchorType,
  anchorId: string,
  userId: string,
): Promise<{ exists: boolean; owns: boolean }> {
  if (anchorType === "account_contact") {
    const c = await prisma.accountContact.findUnique({
      where: { id: anchorId },
      select: { deletedAt: true, account: { select: { ownerUserId: true } } },
    });
    if (!c || c.deletedAt) return { exists: false, owns: false };
    return { exists: true, owns: c.account.ownerUserId != null && c.account.ownerUserId === userId };
  }
  const d = await prisma.deal.findUnique({
    where: { id: anchorId },
    select: { deletedAt: true, ownerUserId: true },
  });
  if (!d || d.deletedAt) return { exists: false, owns: false };
  return { exists: true, owns: d.ownerUserId != null && d.ownerUserId === userId };
}

const THREAD_SELECT = { id: true, accountContactId: true, dealId: true } as const;

// The one shared team channel (kind "team", channelKey "team") — every approved
// user can see and post. Get-or-create; on create, seed a participant row for
// every active approved user so unread badging reaches the whole team.
async function loadTeamChannel(user: Actor): Promise<LoadThreadResult> {
  const existing = await prisma.chatThread.findFirst({ where: { channelKey: "team" }, select: THREAD_SELECT });
  if (existing) return { thread: existing, owns: false, admin: isAdmin(user.role), created: false };
  const members = await prisma.user.findMany({
    where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
    select: { id: true },
  });
  const created = await prisma.chatThread.create({
    data: {
      kind: "team",
      channelKey: "team",
      createdByUserId: user.id,
      participants: { create: members.map((m) => ({ userId: m.id, role: "TEAM" })) },
    },
    select: THREAD_SELECT,
  });
  return { thread: created, owns: false, admin: isAdmin(user.role), created: true };
}

// A 1:1 DM identified by the sorted user pair — the caller and `otherId`. Each
// (caller, other) resolves to exactly that pair's thread, so a third user can
// never reach it (their /dm/<other> resolves to a different pair).
async function loadDm(otherId: string, user: Actor): Promise<LoadThreadResult> {
  if (otherId === user.id) return { error: "bad_dm", status: 400 };
  const other = await prisma.user.findFirst({
    where: { id: otherId, deletedAt: null, isActive: true, approvalStatus: "approved" },
    select: { id: true },
  });
  if (!other) return { error: "not_found", status: 404 };
  const channelKey = `dm:${[user.id, otherId].sort().join(":")}`;
  const existing = await prisma.chatThread.findFirst({ where: { channelKey }, select: THREAD_SELECT });
  if (existing) return { thread: existing, owns: false, admin: isAdmin(user.role), created: false };
  const created = await prisma.chatThread.create({
    data: {
      kind: "dm",
      channelKey,
      createdByUserId: user.id,
      participants: { create: [{ userId: user.id, role: "DM" }, { userId: otherId, role: "DM" }] },
    },
    select: THREAD_SELECT,
  });
  return { thread: created, owns: false, admin: isAdmin(user.role), created: true };
}

export async function loadThreadAuthorized(
  anchorType: ChatAnchorType,
  anchorId: string,
  user: Actor,
): Promise<LoadThreadResult> {
  if (anchorType === "team") return loadTeamChannel(user);
  if (anchorType === "dm") return loadDm(anchorId, user);

  const admin = isAdmin(user.role);
  const anchor = await resolveAnchor(anchorType, anchorId, user.id);
  if (!anchor.exists) return { error: "not_found", status: 404 };

  const anchorWhere = anchorType === "account_contact" ? { accountContactId: anchorId } : { dealId: anchorId };
  const existing = await prisma.chatThread.findFirst({
    where: anchorWhere,
    select: { id: true, accountContactId: true, dealId: true },
  });

  // Access: admin OR owns the record OR an OWNER/TAGGED participant OR an
  // active coverage grant. COVERING participant rows do NOT themselves grant
  // access — coverage is authorized by a live CoverageGrant so expiry is
  // honored the instant the window ends, before the cleanup sweep runs.
  let allowed = admin || anchor.owns;
  if (!allowed && existing) {
    const p = await prisma.chatParticipant.findUnique({
      where: { threadId_userId: { threadId: existing.id, userId: user.id } },
      select: { role: true },
    });
    if (p && p.role !== "COVERING") allowed = true;
  }
  if (!allowed) {
    const cov = await prisma.coverageGrant.findFirst({
      where: {
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(anchorType === "account_contact" ? { accountContactId: anchorId } : { dealId: anchorId }),
      },
      select: { id: true },
    });
    if (cov) allowed = true;
  }
  if (!allowed) return { error: "forbidden", status: 403 };

  if (existing) return { thread: existing, owns: anchor.owns, admin, created: false };

  // First authorized access → create the thread. If this user owns the
  // record, seed an OWNER participant row so the thread shows in their inbox.
  const created = await prisma.chatThread.create({
    data: {
      ...anchorWhere,
      createdByUserId: user.id,
      ...(anchor.owns ? { participants: { create: { userId: user.id, role: "OWNER" } } } : {}),
    },
    select: { id: true, accountContactId: true, dealId: true },
  });
  return { thread: created, owns: anchor.owns, admin, created: true };
}
