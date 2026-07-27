// Posts a handoff/coverage event into a thread as a normal message authored by
// the actor, so the who/what/when is logged in-context (no separate Activity
// timeline plumbing needed). Bumps unread for everyone else, same as a real
// message. Reused by the handoff + coverage-revert flows.
import { prisma } from "@/lib/prisma";

export async function postThreadNote(threadId: string, authorUserId: string, body: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const msg = await tx.chatMessage.create({ data: { threadId, authorUserId, body } });
    await tx.chatParticipant.upsert({
      where: { threadId_userId: { threadId, userId: authorUserId } },
      create: { threadId, userId: authorUserId, role: "TAGGED", lastReadAt: new Date(), unreadCount: 0 },
      update: { lastReadAt: new Date(), unreadCount: 0 },
    });
    await tx.chatParticipant.updateMany({
      where: { threadId, userId: { not: authorUserId } },
      data: { unreadCount: { increment: 1 } },
    });
    await tx.chatThread.update({ where: { id: threadId }, data: { lastMessageAt: msg.createdAt } });
  });
}
