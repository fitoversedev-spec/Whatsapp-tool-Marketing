// Print recent inbound + outbound messages + any flow row for one phone.
// Run: npx tsx scripts/debug-conversation.ts +917904184119

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    console.error("usage: debug-conversation.ts <phoneE164>");
    process.exit(1);
  }
  const contactPhone = phone.startsWith("+") ? phone.slice(1) : phone;

  const convo = await prisma.conversation.findFirst({
    where: { contactPhone },
    orderBy: { createdAt: "desc" },
  });
  if (!convo) {
    console.log("No conversation found for", contactPhone);
    return;
  }
  console.log("Conversation:", convo.id);
  console.log("  contactPhone:", convo.contactPhone);
  console.log("  status:", convo.status);
  console.log("  lastInboundAt:", convo.lastInboundAt);
  console.log("  lastOutboundAt:", convo.lastOutboundAt);

  const flow = await prisma.conversationFlow.findUnique({
    where: { conversationId: convo.id },
  });
  console.log("\nFlow:", flow ? "yes" : "none");
  if (flow) {
    console.log("  currentStep:", flow.currentStep);
    console.log("  path:", flow.path);
    console.log("  endedAt:", flow.endedAt);
    console.log("  endReason:", flow.endReason);
    console.log("  startedAt:", flow.startedAt);
    console.log("  updatedAt:", flow.updatedAt);
    console.log("  collectedData:", flow.collectedData);
  }

  const optOut = await prisma.optOut.findUnique({
    where: { phoneE164: contactPhone },
  });
  console.log("\nOptOut:", optOut ? optOut.optedOutAt : "no");

  const msgs = await prisma.message.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log("\nLast 10 messages:");
  for (const m of msgs.reverse()) {
    console.log(
      `  ${m.createdAt.toISOString()}  ${m.direction.padEnd(8)} ${m.type.padEnd(8)}  ${(m.body ?? "").slice(0, 120).replace(/\n/g, " / ")}`,
    );
  }

  const logs = await prisma.autoReplyLog.findMany({
    where: { contactPhone },
    orderBy: { firedAt: "desc" },
    take: 5,
  });
  console.log("\nLast 5 auto-reply firings:");
  for (const l of logs) {
    console.log(
      `  ${l.firedAt.toISOString()}  rule=${l.ruleId}  triggered by "${(l.triggeredBy ?? "").slice(0, 60)}"`,
    );
  }
}

main()
  .catch((err) => {
    console.error("debug failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
