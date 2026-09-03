import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { Pool } from "pg";

/**
 * A single pool per process. Next dev reloads modules on every edit, so the
 * pool is parked on globalThis to stop connection counts creeping up against
 * Neon's limit.
 *
 * ⚠️ **This hook is also the test suite's isolation seam.** `tests/helpers/
 * testPool.ts` installs its own pool on `globalThis.__ssPool` before `@/db` is
 * first imported, with a `connect` handler that pins every connection to the
 * run's private schema. Prisma is therefore constructed over an *existing*
 * `pg.Pool` through the driver adapter rather than being handed a connection
 * string — a Prisma client that opened its own connections would have no place
 * to run that `SET search_path`, and every suite would land in `public`.
 */
const globalForDb = globalThis as unknown as { __ssPool?: Pool; __ssPrisma?: PrismaClient };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the Neon connection string.",
    );
  }
  return url;
}

export function getPool(): Pool {
  if (!globalForDb.__ssPool) {
    globalForDb.__ssPool = new Pool({
      connectionString: connectionString(),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return globalForDb.__ssPool;
}

/**
 * The Postgres schema Prisma's generated SQL is qualified with.
 *
 * ⚠️ **Prisma does not use `search_path`.** Its query engine writes the schema
 * name into every statement it generates — `SELECT … FROM "public"."users"` —
 * taken from the datasource, or from the driver adapter's `schema` option when
 * one is given. Raw SQL (`$queryRaw`) is the opposite: it goes to the database
 * verbatim and resolves through `search_path` like any other statement.
 *
 * Left alone, that combination is silently wrong under the test harness, which
 * gives each run its own `test_<random>` schema and pins connections to it with
 * `SET search_path`. Prisma's model queries would ignore that and hit `public`
 * — the shared schema — while the raw queries beside them hit the run's own.
 * The suite would not fail; it would quietly stop being isolated, and start
 * truncating `users` in a schema other people are using.
 *
 * So the schema is explicit on both sides: `DATABASE_SCHEMA` here, and the same
 * value in the pool's `SET search_path` (see `tests/helpers/testPool.ts`).
 * Unset — which is the case in dev and production — it is `public`, exactly
 * what Prisma would have assumed anyway.
 */
export function databaseSchema(): string {
  return process.env.DATABASE_SCHEMA || "public";
}

function createClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(getPool(), {
      schema: databaseSchema(),
      disposeExternalPool: false,
    }),
  });
}

export const prisma: PrismaClient = (globalForDb.__ssPrisma ??= createClient());

/**
 * What a repository function accepts.
 *
 * `Prisma.TransactionClient` is what `prisma.$transaction(async (tx) => …)`
 * hands the callback: the same model delegates and the same `$queryRaw`, minus
 * `$transaction` itself. Functions that only read or write take `Database` and
 * work either inside a transaction or outside one; functions that *open* a
 * transaction take `PrismaClient`.
 */
export type Database = PrismaClient | Prisma.TransactionClient;

/**
 * A client that can *open* a transaction — which `Prisma.TransactionClient`
 * cannot, since it is already inside one. Functions that call `$transaction`
 * take this; everything else takes `Database`.
 */
export type DatabaseClient = PrismaClient;

export { Prisma };
