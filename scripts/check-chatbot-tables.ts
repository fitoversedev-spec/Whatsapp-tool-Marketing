// Quick check: do the ConversationFlow + BotLead tables actually
// exist on the connected Postgres? If Vercel is running against a
// DB that never got `prisma db push` after the schema change, the
// chatbot dispatcher will silently return false on every message.
// Run: npx tsx scripts/check-chatbot-tables.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Which DB are we hitting?
  const [{ current_database }] = await prisma.$queryRawUnsafe<
    Array<{ current_database: string }>
  >("select current_database()");
  console.log("DB:", current_database);

  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "select tablename from pg_tables where schemaname = 'public' and tablename in ('conversation_flows','bot_leads') order by tablename",
  );
  console.log("Chatbot tables present:");
  for (const r of rows) console.log("  -", r.tablename);
  if (rows.length < 2) {
    console.log(
      "\n⚠️  Missing table(s). Prisma will throw on every ConversationFlow query.",
    );
    console.log("Fix: npx prisma db push");
  } else {
    console.log("\n✔ Tables exist. Chatbot silent-failure is somewhere else.");
    // Sanity-check row counts.
    const flowCount = await prisma.conversationFlow.count().catch(() => -1);
    const leadCount = await prisma.botLead.count().catch(() => -1);
    console.log(`conversation_flows rows: ${flowCount}`);
    console.log(`bot_leads rows: ${leadCount}`);
  }
}

main()
  .catch((err) => {
    console.error("check failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
