"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  accountId: string;
  accountName: string;
  converted: boolean;
};

export default function LeadsClient({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const visible = leads.filter(
    (l) =>
      !q.trim() ||
      l.name.toLowerCase().includes(q.trim().toLowerCase()) ||
      l.accountName.toLowerCase().includes(q.trim().toLowerCase()),
  );

  // Reuses POST /api/deals exactly like the contact page's CreateDealFirstModal
  // — title + accountId + primaryContactId; the deal's owner is forced to the
  // caller server-side, so this can't hand a lead to someone else's pipeline.
  async function convertToDeal(lead: Lead) {
    setConvertingId(lead.id);
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Deal for ${lead.name}`,
        accountId: lead.accountId,
        primaryContactId: lead.id,
      }),
    });
    setConvertingId(null);
    if (!res.ok) {
      toast.error("Could not create deal");
      return;
    }
    toast.success(`Deal created for ${lead.name}`);
    router.refresh();
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        large
        title="Leads"
        description={`${leads.length} promoted lead${leads.length === 1 ? "" : "s"} — contacts being actively worked toward a deal`}
      />

      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or company..."
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-xs"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600 border-b border-slate-200">
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Company</th>
              <th className="px-4 py-2.5 font-semibold">Phone</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link href={`/crm/contacts/${l.id}`} className="font-medium text-wa-dark hover:underline">
                    {l.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/crm/companies/${l.accountId}`} className="text-slate-600 hover:underline">{l.accountName}</Link>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{l.phone ?? "—"}</td>
                <td className="px-4 py-2.5">
                  {l.converted ? (
                    <span className="text-[10px] font-semibold text-wa-dark bg-wa-green/10 px-1.5 py-0.5 rounded">CONVERTED</span>
                  ) : (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">OPEN</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {!l.converted && (
                    <button
                      onClick={() => convertToDeal(l)}
                      disabled={convertingId === l.id}
                      className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-3 py-1 rounded-md text-xs disabled:opacity-50"
                    >
                      {convertingId === l.id ? "Converting..." : "Convert to Deal"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No leads yet — promote a contact from the Contacts list.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
