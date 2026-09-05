import type { Metadata } from "next";
import { Badge } from "@/components/scout/ui";
import { ScreenScaffold, SectionLabel } from "@/components/scout/patterns";
import { prisma } from "@/lib/scout/db";
import { getUsageByUserAndDay } from "@/lib/scout/places/metering";
import { placesConfig } from "@/lib/scout/places/config";

export const metadata: Metadata = { title: "Usage — Site Scout admin" };
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const currency = (usd: number) =>
  usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`;

interface RepSummary {
  userId: string;
  email: string;
  name: string | null;
  scans: number;
  apiCalls: number;
  cacheHits: number;
  costUsd: number;
  lastScanAt: Date | null;
}

export default async function AdminUsagePage() {
  const [usageRows, scanCounts, users] = await Promise.all([
    getUsageByUserAndDay(30),
    prisma.scan.groupBy({
      by: ["ownerId"],
      _count: { id: true },
    }),
    prisma.user.findMany({
      where: { approvalStatus: "approved" },
      select: { id: true, email: true, name: true },
    }),
  ]);

  const lastScanByUser = await prisma.scan.groupBy({
    by: ["ownerId"],
    _max: { createdAt: true },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));
  const scanMap = new Map(scanCounts.map((r) => [r.ownerId, r._count.id]));
  const lastScanMap = new Map(
    lastScanByUser.map((r) => [r.ownerId, r._max.createdAt]),
  );

  const usageByUser = new Map<
    string,
    { calls: number; cacheHits: number; costUsd: number }
  >();
  for (const row of usageRows) {
    if (!row.userId) continue;
    const existing = usageByUser.get(row.userId) ?? {
      calls: 0,
      cacheHits: 0,
      costUsd: 0,
    };
    existing.calls += row.calls;
    existing.cacheHits += row.cacheHits;
    existing.costUsd += row.costUsd;
    usageByUser.set(row.userId, existing);
  }

  const allUserIds = new Set([
    ...scanMap.keys(),
    ...usageByUser.keys(),
  ]);

  const reps: RepSummary[] = [];
  for (const userId of allUserIds) {
    const user = userMap.get(userId);
    if (!user) continue;
    const usage = usageByUser.get(userId);
    reps.push({
      userId,
      email: user.email,
      name: user.name,
      scans: scanMap.get(userId) ?? 0,
      apiCalls: usage?.calls ?? 0,
      cacheHits: usage?.cacheHits ?? 0,
      costUsd: usage?.costUsd ?? 0,
      lastScanAt: lastScanMap.get(userId) ?? null,
    });
  }

  reps.sort((a, b) => b.costUsd - a.costUsd);

  const totals = reps.reduce(
    (acc, r) => ({
      scans: acc.scans + r.scans,
      apiCalls: acc.apiCalls + r.apiCalls,
      cacheHits: acc.cacheHits + r.cacheHits,
      costUsd: acc.costUsd + r.costUsd,
    }),
    { scans: 0, apiCalls: 0, cacheHits: 0, costUsd: 0 },
  );

  const cacheHitRate =
    totals.apiCalls + totals.cacheHits === 0
      ? 0
      : Math.round(
          (totals.cacheHits / (totals.apiCalls + totals.cacheHits)) * 100,
        );

  return (
    <ScreenScaffold
      eyebrow="Admin"
      title="Usage"
      lede="Scan counts and estimated Google API costs per team member (last 30 days)."
    >
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="Total scans" value={String(totals.scans)} />
        <SummaryCard label="API calls" value={totals.apiCalls.toLocaleString()} />
        <SummaryCard label="Est. cost" value={currency(totals.costUsd)} />
        <SummaryCard
          label="Cache hit rate"
          value={`${cacheHitRate}%`}
          sub={`Daily cap: ${placesConfig.dailyCallCap}`}
        />
      </div>

      {/* Per-rep table */}
      <SectionLabel weight={700} as="h2">
        Per team member ({reps.length})
      </SectionLabel>

      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
        <div className="grid grid-cols-[1.4fr_0.6fr_0.8fr_0.8fr_0.8fr] bg-slate-100 text-slate-600 px-4 py-3 text-xs font-semibold uppercase tracking-wider max-[900px]:hidden">
          <span>Name</span>
          <span className="text-right">Scans</span>
          <span className="text-right">API calls</span>
          <span className="text-right">Est. cost</span>
          <span className="text-right">Last scan</span>
        </div>
        {reps.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 text-center">
            No usage data yet.
          </p>
        ) : (
          reps.map((rep) => (
            <div
              key={rep.userId}
              className="grid grid-cols-[1.4fr_0.6fr_0.8fr_0.8fr_0.8fr] items-center border-t border-slate-200 px-4 py-3 text-sm text-slate-700 gap-3 even:bg-slate-50 max-[900px]:grid-cols-1 max-[900px]:gap-1.5"
            >
              <div className="min-w-0">
                <span className="font-semibold text-slate-900 block truncate">
                  {rep.name || "—"}
                </span>
                <span className="text-xs text-slate-500 block truncate">
                  {rep.email}
                </span>
              </div>
              <span className="text-right tabular-nums">
                {rep.scans}
              </span>
              <span className="text-right tabular-nums">
                {rep.apiCalls.toLocaleString()}
                {rep.cacheHits > 0 && (
                  <span className="text-xs text-slate-400 ml-1">
                    +{rep.cacheHits} cached
                  </span>
                )}
              </span>
              <span className="text-right tabular-nums">
                <Badge tone={rep.costUsd > 1 ? "red" : "neutral"}>
                  {currency(rep.costUsd)}
                </Badge>
              </span>
              <span className="text-right text-xs text-slate-500">
                {rep.lastScanAt ? dateFormat.format(rep.lastScanAt) : "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </ScreenScaffold>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
