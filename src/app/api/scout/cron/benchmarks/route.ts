/**
 * Nightly city-benchmark recompute.
 *
 * Scheduled by `vercel.json`. Vercel Cron sends an `Authorization: Bearer
 * $CRON_SECRET` header when `CRON_SECRET` is set in the project environment;
 * without it, this endpoint would let anyone on the internet trigger a full
 * table rewrite.
 *
 * `CRON_SECRET` is read directly from `process.env` rather than through
 * `src/lib/env.ts`, because Phase 1 owns that file and this phase runs in
 * parallel. It should be folded into `env.ts` when the phases merge — see
 * `docs/PHASE-2-HANDOFF.md`.
 */
import { NextResponse } from "next/server";
import { recomputeCityBenchmarks } from "@/lib/scout/benchmarks/compute";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  // Refusing when unconfigured is deliberate. An open endpoint that rewrites a
  // table the report cites is worse than a cron job that visibly does not run.
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorised(request)) {
    const reason = process.env.CRON_SECRET
      ? "Invalid cron credentials."
      : "CRON_SECRET is not set, so the benchmark cron is disabled.";
    return NextResponse.json({ ok: false, error: reason }, { status: 401 });
  }

  try {
    const result = await recomputeCityBenchmarks();

    if (!result.manualOverridesSupported && result.rowsWritten > 0) {
      console.warn(
        "[benchmarks] city_benchmarks.is_manual_override does not exist; " +
          "any hand-set benchmark was replaced by this recompute.",
      );
    }
    console.info("[benchmarks] recompute complete", result);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[benchmarks] recompute failed", error);
    return NextResponse.json({ ok: false, error: "Benchmark recompute failed." }, { status: 500 });
  }
}
