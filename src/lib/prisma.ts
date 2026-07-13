import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Neon's POOLED (-pooler) endpoint needs PgBouncer-friendly connection params
// for Prisma. Without `pgbouncer=true` + timeouts, connections get force-closed
// ("Closed" / ConnectionReset 10054) and every query stalls reconnecting — which
// is exactly what makes the app hang (e.g. /api/unread/count taking ~4s). We
// augment the URL here so it works without editing .env; each param is a no-op
// if already present.
function connectionUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const setIfAbsent = (k: string, v: string) => {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    };
    // Only tell Prisma it's PgBouncer when we're actually on the pooled host.
    if (u.host.includes("-pooler")) setIfAbsent("pgbouncer", "true");
    setIfAbsent("connect_timeout", "15"); // fail fast instead of hanging forever
    setIfAbsent("pool_timeout", "20");
    return u.toString();
  } catch {
    return raw; // malformed URL — let Prisma surface its own error
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: connectionUrl(),
    // Query logging is OFF by default — logging every query (the inbox polls
    // fire a lot) is real overhead and floods the console. Opt back in with
    // PRISMA_LOG_QUERIES=1 when you actually need to trace SQL.
    log:
      process.env.PRISMA_LOG_QUERIES === "1"
        ? ["query", "error", "warn"]
        : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
