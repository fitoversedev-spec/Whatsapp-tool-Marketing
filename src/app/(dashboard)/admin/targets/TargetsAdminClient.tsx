"use client";

import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { PeriodPicker } from "@/components/analytics/PeriodPicker";
import { fmtInr } from "@/components/analytics/charts";
import { currentPeriod, describePeriod, type Period } from "@/lib/analytics/periodPresets";

type AssignableUser = { id: string; name: string; role: string; email: string };

type TargetRow = {
  id: string;
  scopeType: "USER" | "COMPANY";
  scopeId: string | null;
  periodType: "MONTH" | "QUARTER" | "FY";
  periodStart: string;
  targetRevenue: number;
  targetDeals: number | null;
  setByUserId: string;
  updatedAt: string;
};

export default function TargetsAdminClient() {
  const toast = useToast();
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [scopeId, setScopeId] = useState<string>("company");
  const [period, setPeriod] = useState<Period>(() => currentPeriod("MONTH"));
  const [targetRevenue, setTargetRevenue] = useState("");
  const [targetDeals, setTargetDeals] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [usersRes, targetsRes] = await Promise.all([fetch("/api/users/assignable"), fetch("/api/admin/targets")]);
    if (usersRes.ok) setUsers((await usersRes.json()).users);
    if (targetsRes.ok) setTargets((await targetsRes.json()).targets);
    else toast.error("Failed to load targets");
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function usersById(): Map<string, AssignableUser> {
    return new Map(users.map((u) => [u.id, u]));
  }

  async function submit() {
    const revenue = Number(targetRevenue);
    if (!Number.isFinite(revenue) || revenue < 0) {
      toast.error("Enter a valid target revenue");
      return;
    }
    const deals = targetDeals.trim() === "" ? null : Number(targetDeals);
    if (deals != null && (!Number.isFinite(deals) || deals < 0)) {
      toast.error("Target deals must be a positive number");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/admin/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeType: scopeId === "company" ? "COMPANY" : "USER",
        scopeId: scopeId === "company" ? null : scopeId,
        periodType: period.type,
        periodStart: period.start.toISOString().slice(0, 10),
        targetRevenue: revenue,
        targetDeals: deals,
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Target saved");
      setTargetRevenue("");
      setTargetDeals("");
      load();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Save failed");
    }
  }

  const byId = usersById();

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <PageHeader
        title="Targets"
        description="Set company-wide or per-rep revenue targets by month, quarter, or fiscal year — drives the pace/gap numbers on CRM Analytics → Overview."
      />

      <div className="bg-white rounded-xl border border-slate-200 p-4 mt-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Scope</label>
          <select
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="w-full sm:w-auto border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
          >
            <option value="company">Company-wide</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Period</label>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>

        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Target revenue (₹)</label>
            <input
              type="number"
              min={0}
              value={targetRevenue}
              onChange={(e) => setTargetRevenue(e.target.value)}
              placeholder="e.g. 5000000"
              className="w-48 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Target deals (optional)</label>
            <input
              type="number"
              min={0}
              value={targetDeals}
              onChange={(e) => setTargetDeals(e.target.value)}
              placeholder="e.g. 12"
              className="w-32 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
            />
          </div>
        </div>

        <button
          onClick={submit}
          disabled={saving}
          className="bg-wa-green hover:bg-wa-green/90 disabled:opacity-40 text-white text-sm font-medium px-4 py-1.5 rounded-lg"
        >
          {saving ? "Saving…" : "Save target"}
        </button>
      </div>

      <h2 className="text-sm font-semibold text-slate-700 mt-6 mb-2">Existing targets</h2>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
        ) : targets.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No targets set yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 font-medium">Scope</th>
                <th className="px-4 py-2.5 font-medium">Period</th>
                <th className="px-4 py-2.5 font-medium">Target revenue</th>
                <th className="px-4 py-2.5 font-medium">Target deals</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 text-slate-800">
                    {t.scopeType === "COMPANY" ? "Company-wide" : (byId.get(t.scopeId ?? "")?.name ?? "Unknown rep")}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{describePeriod(t.periodType, new Date(t.periodStart))}</td>
                  <td className="px-4 py-2.5 text-slate-700">{fmtInr(t.targetRevenue)}</td>
                  <td className="px-4 py-2.5 text-slate-700">{t.targetDeals ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{new Date(t.updatedAt).toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
