// Seed initial admin user + optional demo data.
// Run: npx tsx scripts/seed.ts
// Reads SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME, DEMO_SEED from .env

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || "").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "";
  const name = process.env.SEED_ADMIN_NAME || "Admin";

  if (!email || !password) {
    console.error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env");
    process.exit(1);
  }

  let admin = await prisma.user.findUnique({ where: { email } });
  if (!admin) {
    const passwordHash = await bcrypt.hash(password, 10);
    admin = await prisma.user.create({
      data: { email, passwordHash, name, role: "admin", approvalStatus: "approved" },
    });
    console.log(`Created admin user ${admin.email} (id=${admin.id})`);
  } else {
    // Make sure seed admin stays approved even if the row pre-exists
    if (admin.approvalStatus !== "approved") {
      admin = await prisma.user.update({
        where: { id: admin.id },
        data: { approvalStatus: "approved" },
      });
      console.log(`Promoted existing admin ${email} to approved`);
    } else {
      console.log(`Admin ${email} already exists`);
    }
  }

  if (process.env.DEMO_SEED !== "true") return;

  // Demo sales user
  let sales = await prisma.user.findUnique({ where: { email: "sales@demo.local" } });
  if (!sales) {
    const hash = await bcrypt.hash("sales123", 10);
    sales = await prisma.user.create({
      data: {
        email: "sales@demo.local",
        passwordHash: hash,
        name: "Priya (Sales)",
        role: "sales",
        approvalStatus: "approved",
      },
    });
    console.log(`Created sales user ${sales.email}`);
  } else if (sales.approvalStatus !== "approved") {
    sales = await prisma.user.update({
      where: { id: sales.id },
      data: { approvalStatus: "approved" },
    });
    console.log(`Promoted existing sales user ${sales.email} to approved`);
  }

  // Demo pending/rejected users so the approvals UI has content
  const demoSignups = [
    {
      email: "rahul.kumar@demo.local",
      name: "Rahul Kumar",
      role: "sales",
      approvalStatus: "pending",
      rejectionReason: null,
    },
    {
      email: "anita.sharma@demo.local",
      name: "Anita Sharma",
      role: "admin",
      approvalStatus: "pending",
      rejectionReason: null,
    },
    {
      email: "former.contractor@demo.local",
      name: "Vikram (Ex-Contractor)",
      role: "sales",
      approvalStatus: "rejected",
      rejectionReason: "Contract ended on 2026-04-30",
    },
  ];
  const demoHash = await bcrypt.hash("demo1234", 10);
  for (const u of demoSignups) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) continue;
    await prisma.user.create({
      data: { ...u, passwordHash: demoHash },
    });
  }
  console.log("Seeded demo signup requests (2 pending, 1 rejected)");

  // Demo templates
  const tplDefs = [
    {
      name: "order_confirmation",
      language: "en",
      category: "UTILITY",
      body: "Hi {{1}}, your order #{{2}} has been confirmed and will ship within 24 hours. Thank you!",
      footer: "Reply STOP to opt out",
      status: "approved" as const,
    },
    {
      name: "may_promo_offer",
      language: "en",
      category: "MARKETING",
      body: "Hi {{1}}, enjoy 20% off this week with code {{2}}. Shop before May 31!",
      footer: "Reply STOP to opt out",
      status: "approved" as const,
    },
    {
      name: "monsoon_sale_v2",
      language: "en",
      category: "MARKETING",
      body: "Hello {{1}}! Our monsoon sale is live — extra 15% off on orders above ₹1000. Tap to shop.",
      footer: null,
      status: "pending_admin" as const,
    },
    {
      name: "appointment_reminder",
      language: "en",
      category: "UTILITY",
      body: "Hi {{1}}, this is a reminder of your appointment on {{2}} at {{3}}. See you soon!",
      footer: null,
      status: "draft" as const,
    },
  ];
  const templates: Record<string, string> = {};
  for (const t of tplDefs) {
    const exists = await prisma.template.findFirst({ where: { name: t.name } });
    if (exists) {
      templates[t.name] = exists.id;
      continue;
    }
    const created = await prisma.template.create({
      data: {
        ...t,
        draftedByUserId: t.status === "draft" || t.status === "pending_admin" ? sales.id : admin.id,
        approvedByUserId: t.status === "approved" ? admin.id : null,
        metaTemplateId: t.status === "approved" ? `meta_tpl_${Math.random().toString(36).slice(2, 10)}` : null,
        submittedAt: t.status === "approved" ? new Date(Date.now() - 86400000 * 7) : null,
      },
    });
    templates[t.name] = created.id;
  }
  console.log(`Seeded ${tplDefs.length} templates`);

  // Demo conversations + messages
  const convoDefs = [
    {
      phone: "919876543210",
      contactName: "Rahul Kumar",
      assignedTo: sales.id,
      messages: [
        { dir: "outbound" as const, body: "Hi Rahul, enjoy 20% off this week with code MAY20.", offsetMin: -120 },
        { dir: "inbound" as const, body: "Thanks! Does this work on the blue shoes I was looking at?", offsetMin: -90 },
        { dir: "outbound" as const, body: "Yes, the discount applies to all items in our store.", offsetMin: -85 },
        { dir: "inbound" as const, body: "Perfect, ordering now.", offsetMin: -10 },
      ],
    },
    {
      phone: "919812345678",
      contactName: "Anita Sharma",
      assignedTo: null, // unassigned — visible to all sales
      messages: [
        { dir: "outbound" as const, body: "Hi Anita, your order #ORD-4521 has been confirmed.", offsetMin: -300 },
        { dir: "inbound" as const, body: "When will it arrive?", offsetMin: -250 },
      ],
    },
    {
      phone: "919900112233",
      contactName: "Vikram Singh",
      assignedTo: sales.id,
      messages: [
        { dir: "inbound" as const, body: "Hello, is anyone there?", offsetMin: -45 },
      ],
    },
    {
      phone: "919765432109",
      contactName: "Meera Patel",
      assignedTo: null,
      messages: [
        { dir: "outbound" as const, body: "Hi Meera, enjoy 20% off this week.", offsetMin: -1440 },
        { dir: "inbound" as const, body: "STOP", offsetMin: -1380 },
      ],
    },
  ];

  for (const c of convoDefs) {
    const existing = await prisma.conversation.findUnique({ where: { contactPhone: c.phone } });
    if (existing) continue;
    const lastInboundMsg = c.messages.filter((m) => m.dir === "inbound").pop();
    const lastInbound = lastInboundMsg ? new Date(Date.now() + lastInboundMsg.offsetMin * 60000) : null;
    const lastOutbound = c.messages.filter((m) => m.dir === "outbound").pop();
    const lastOutboundTime = lastOutbound ? new Date(Date.now() + lastOutbound.offsetMin * 60000) : null;
    const unread = c.messages.filter((m) => m.dir === "inbound").length;

    const convo = await prisma.conversation.create({
      data: {
        contactPhone: c.phone,
        contactName: c.contactName,
        assignedToUserId: c.assignedTo,
        lastInboundAt: lastInbound,
        lastOutboundAt: lastOutboundTime,
        unreadCount: unread,
      },
    });

    for (const m of c.messages) {
      await prisma.message.create({
        data: {
          conversationId: convo.id,
          direction: m.dir,
          type: "text",
          body: m.body,
          waMessageId: `demo_${Math.random().toString(36).slice(2)}`,
          status: m.dir === "outbound" ? "read" : "delivered",
          sentByUserId: m.dir === "outbound" ? sales.id : null,
          createdAt: new Date(Date.now() + m.offsetMin * 60000),
        },
      });
    }
  }
  console.log(`Seeded ${convoDefs.length} conversations`);

  // Opt-out for Meera
  await prisma.optOut.upsert({
    where: { phoneE164: "919765432109" },
    create: { phoneE164: "919765432109", reason: "stop_reply" },
    update: {},
  });

  // Demo broadcasts
  const broadcastDefs = [
    {
      name: "May Promo — Top 200 customers",
      templateId: templates["may_promo_offer"],
      status: "completed" as const,
      total: 200,
      sent: 200,
      delivered: 196,
      read: 142,
      failed: 4,
      createdBy: sales.id,
      hoursAgo: 26,
    },
    {
      name: "Order confirmations batch",
      templateId: templates["order_confirmation"],
      status: "completed" as const,
      total: 42,
      sent: 42,
      delivered: 42,
      read: 38,
      failed: 0,
      createdBy: admin.id,
      hoursAgo: 5,
    },
    {
      name: "Weekend campaign (in progress)",
      templateId: templates["may_promo_offer"],
      status: "running" as const,
      total: 500,
      sent: 312,
      delivered: 285,
      read: 91,
      failed: 8,
      createdBy: sales.id,
      hoursAgo: 0.2,
    },
  ];

  for (const b of broadcastDefs) {
    const existing = await prisma.broadcast.findFirst({ where: { name: b.name } });
    if (existing) continue;
    const created = await prisma.broadcast.create({
      data: {
        name: b.name,
        sheetId: "demo_sheet_id",
        sheetRange: "Sheet1!A2:D",
        templateId: b.templateId,
        variableMapping: JSON.stringify({ phoneColumn: "A", nameColumn: "B", variables: { "1": "B", "2": "C" } }),
        status: b.status,
        total: b.total,
        sent: b.sent,
        delivered: b.delivered,
        read: b.read,
        failed: b.failed,
        createdByUserId: b.createdBy,
        launchedAt: new Date(Date.now() - b.hoursAgo * 3600000),
        completedAt: b.status === "completed" ? new Date(Date.now() - b.hoursAgo * 3600000 + 600000) : null,
      },
    });

    // Seed recipients with realistic distribution
    const sampleNames = [
      "Aarav Patel", "Diya Reddy", "Ishaan Iyer", "Saanvi Joshi", "Aditya Nair",
      "Riya Kumar", "Arjun Shah", "Anya Mehta", "Krishna Rao", "Aanya Gupta",
      "Vivaan Verma", "Pari Singh", "Reyansh Das", "Myra Khanna", "Kabir Bose",
      "Sara Pillai", "Ayaan Chopra", "Tara Menon", "Dhruv Kapoor", "Ira Banerjee",
    ];
    const failureReasons = [
      { code: "131026", message: "Receiver is incapable of receiving this message" },
      { code: "131048", message: "Spam rate limit hit" },
      { code: "131056", message: "User has blocked the business" },
      { code: "131000", message: "Generic error from Meta" },
    ];

    const recipientData: any[] = [];
    // Generate stable list — use a deterministic phone pattern so re-seeds don't conflict
    const max = Math.min(b.total, 60); // cap at 60 for readability
    for (let i = 0; i < max; i++) {
      const phone = `919${(900000000 + Math.floor(Math.random() * 99999999)).toString().slice(0, 9)}`;
      const seed = Math.random();
      let status: string;
      let errorCode: string | null = null;
      let errorMessage: string | null = null;
      let sentAt: Date | null = null;
      let deliveredAt: Date | null = null;
      let readAt: Date | null = null;

      const launchedAt = new Date(Date.now() - b.hoursAgo * 3600000);
      const failedCutoff = b.failed / b.total;
      const sentCutoff = (b.failed + (b.total - b.sent)) / b.total;
      const deliveredCutoff = (b.failed + (b.total - b.delivered)) / b.total;
      const readCutoff = (b.failed + (b.total - b.read)) / b.total;

      if (seed < failedCutoff) {
        status = "failed";
        const reason = failureReasons[Math.floor(Math.random() * failureReasons.length)];
        errorCode = reason.code;
        errorMessage = reason.message;
      } else if (seed < sentCutoff) {
        status = "queued";
      } else if (seed < deliveredCutoff) {
        status = "sent";
        sentAt = new Date(launchedAt.getTime() + Math.random() * 60000);
      } else if (seed < readCutoff) {
        status = "delivered";
        sentAt = new Date(launchedAt.getTime() + Math.random() * 60000);
        deliveredAt = new Date(sentAt.getTime() + Math.random() * 30000);
      } else {
        status = "read";
        sentAt = new Date(launchedAt.getTime() + Math.random() * 60000);
        deliveredAt = new Date(sentAt.getTime() + Math.random() * 30000);
        readAt = new Date(deliveredAt.getTime() + Math.random() * 300000);
      }

      recipientData.push({
        broadcastId: created.id,
        phoneE164: phone,
        name: sampleNames[i % sampleNames.length],
        variables: JSON.stringify({ "1": sampleNames[i % sampleNames.length].split(" ")[0] }),
        waMessageId: `demo_${created.id.slice(0, 6)}_${i}`,
        status,
        errorCode,
        errorMessage,
        sentAt,
        deliveredAt,
        readAt,
      });
    }
    if (recipientData.length > 0) {
      await prisma.broadcastRecipient.createMany({ data: recipientData, skipDuplicates: true });
    }

    // Recompute counters from the actual recipient rows so totals stay consistent
    const groups = await prisma.broadcastRecipient.groupBy({
      by: ["status"],
      where: { broadcastId: created.id },
      _count: { _all: true },
    });
    const c: Record<string, number> = { sent: 0, delivered: 0, read: 0, failed: 0, queued: 0 };
    for (const g of groups) c[g.status] = g._count._all;
    const total = c.sent + c.delivered + c.read + c.failed + c.queued;
    await prisma.broadcast.update({
      where: { id: created.id },
      data: { total, sent: c.sent, delivered: c.delivered, read: c.read, failed: c.failed },
    });
  }
  console.log(`Seeded ${broadcastDefs.length} broadcasts with sample recipients`);
  console.log("\nLogin credentials:");
  console.log(`  Admin:  ${email} / ${password}`);
  console.log(`  Sales:  sales@demo.local / sales123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
