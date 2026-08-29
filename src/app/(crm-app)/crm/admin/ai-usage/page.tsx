// Admin-only AI usage analytics — CRM layout wrapper.
// Full copy of the inline server component since it renders JSX directly
// (cannot be imported as a component from the dashboard route).
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { monthPeriod } from "@/lib/analytics/periodPresets";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

function estInr(inTok: number, outTok: number): number {
  const usd = (inTok / 1_000_000) * 2 + (outTok / 1_000_000) * 10;
  return usd * 86;
}
function fmtInr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: n < 100 ? 2 : 0 });
}

const FEATURE_LABEL: Record<string, string> = {
  template: "Template drafting",
  analytics: "Analytics reports",
};

export default async function CrmAiUsagePage() {
  const user = await requireUser();
  if (!isAdmin(user.role)) redirect("/crm");

  const now = new Date();
  const mp = monthPeriod(now.getFullYear(), now.getMonth());

  const [total, monthCount, byUser, byFeature, totals] = await Promise.all([
    prisma.aiUsage.count(),
    prisma.aiUsage.count({ where: { createdAt: { gte: mp.start, lte: mp.end } } }),
    prisma.aiUsage.groupBy({
      by: ["userId"],
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.aiUsage.groupBy({ by: ["feature"], _count: { _all: true } }),
    prisma.aiUsage.aggregate({ _sum: { inputTokens: true, outputTokens: true } }),
  ]);

  const users = byUser.length
    ? await prisma.user.findMany({
        where: { id: { in: byUser.map((u) => u.userId) } },
        select: { id: true, name: true, email: true, role: true },
      })
    : [];
  const umap = new Map(users.map((u) => [u.id, u]));

  const rows = byUser
    .map((u) => {
      const inTok = u._sum.inputTokens ?? 0;
      const outTok = u._sum.outputTokens ?? 0;
      const person = umap.get(u.userId);
      return {
        key: u.userId,
        name: person?.name ?? "(deleted user)",
        email: person?.email ?? "",
        role: person?.role ?? "",
        requests: u._count._all,
        inTok,
        outTok,
        cost: estInr(inTok, outTok),
      };
    })
    .sort((a, b) => b.requests - a.requests);

  const totalCost = estInr(totals._sum.inputTokens ?? 0, totals._sum.outputTokens ?? 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        large
        title="AI usage"
        description="Who's using AI and how much — every template draft and analytics report is logged here."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        <Card label="Total requests" value={total.toLocaleString("en-IN")} />
        <Card label="This month" value={monthCount.toLocaleString("en-IN")} />
        <Card label="People using AI" value={String(rows.length)} />
        <Card label="Est. total spend" value={fmtInr(totalCost)} hint="Approx, at current rates" />
      </div>

      {byFeature.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {byFeature.map((f) => (
            <span key={f.feature} className="text-xs bg-slate-100 text-slate-700 rounded-full px-3 py-1">
              {FEATURE_LABEL[f.feature] ?? f.feature}: <strong>{f._count._all.toLocaleString("en-IN")}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="mt-6 bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <h2 className="font-bold text-slate-900">Requests by person</h2>
          <p className="text-xs text-slate-500">Ranked most to least.</p>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-500 text-sm">No AI requests yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="px-5 py-2 font-semibold">#</th>
                  <th className="px-5 py-2 font-semibold">Person</th>
                  <th className="px-5 py-2 font-semibold text-right">Requests</th>
                  <th className="px-5 py-2 font-semibold text-right">Tokens (in / out)</th>
                  <th className="px-5 py-2 font-semibold text-right">Est. cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={r.key} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5 text-slate-400 tabular-nums">{i + 1}</td>
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-slate-900">{r.name}</div>
                      <div className="text-xs text-slate-500">
                        {r.email}
                        {r.role ? ` · ${r.role}` : ""}
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold text-slate-900 tabular-nums">
                      {r.requests.toLocaleString("en-IN")}
                    </td>
                    <td className="px-5 py-2.5 text-right text-slate-500 tabular-nums text-xs">
                      {r.inTok.toLocaleString("en-IN")} / {r.outTok.toLocaleString("en-IN")}
                    </td>
                    <td className="px-5 py-2.5 text-right text-slate-700 tabular-nums">{fmtInr(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Cost is an estimate from token usage at current Sonnet 5 rates; the exact billed amount is in the
        Anthropic Console.
      </p>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}
