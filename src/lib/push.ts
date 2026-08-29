import webpush from "web-push";
import { prisma } from "@/lib/prisma";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(
    "mailto:fitoverseofficial3.0@gmail.com",
    VAPID_PUBLIC,
    VAPID_PRIVATE
  );
}

export function isWebPushConfigured(): boolean {
  return !!(VAPID_PUBLIC && VAPID_PRIVATE);
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string }
) {
  if (!isWebPushConfigured()) return;

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dhKey, auth: sub.authKey } },
          JSON.stringify(payload)
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => null);
        }
      }
    })
  );
}

export async function notifyInboundMessage(
  conversation: {
    id: string;
    assignedToUserId: string | null;
    contactName: string | null;
    contactPhone: string;
  },
  messageBody: string | null,
  messageType: string
) {
  if (!isWebPushConfigured()) return;

  const body =
    messageType === "text"
      ? messageBody ?? "New message"
      : messageType === "image"
        ? "📷 Photo"
        : messageType === "video"
          ? "🎥 Video"
          : messageType === "audio"
            ? "🎤 Voice message"
            : messageType === "document"
              ? "📎 Document"
              : "New message";

  const title = conversation.contactName || conversation.contactPhone;
  const url = `/inbox?conversation=${conversation.id}`;
  const payload = { title, body, url, tag: `msg-${conversation.id}` };

  const notifiedIds = new Set<string>();

  if (conversation.assignedToUserId) {
    const rep = await prisma.user.findUnique({
      where: { id: conversation.assignedToUserId },
      select: { pushEnabled: true },
    });
    if (rep?.pushEnabled) {
      await sendPushToUser(conversation.assignedToUserId, payload);
      notifiedIds.add(conversation.assignedToUserId);
    }
  }

  const admins = await prisma.user.findMany({
    where: { role: "admin", pushEnabled: true, isActive: true, deletedAt: null },
    select: { id: true },
  });
  for (const admin of admins) {
    if (!notifiedIds.has(admin.id)) {
      await sendPushToUser(admin.id, payload);
    }
  }
}
