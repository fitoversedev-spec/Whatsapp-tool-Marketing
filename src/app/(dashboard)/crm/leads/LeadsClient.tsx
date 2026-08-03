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

  // Quick-add lead modal state.
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [dupWarn, setDupWarn] = useState(false);

  function resetAdd() {
    setName("");
    setPhone("");
    setLocation("");
    setDupWarn(false);
    setSaving(false);
  }

  // Creates the lead AND its contact in one call: POST /api/account-contacts
  // auto-creates a lightweight Account from the person's name (so the Leads
  // "Company" column shows their name, matching existing behaviour), stamps
  // the contact as a promoted LEAD (asLead), and writes location → account.city.
  async function submitLead(confirmDuplicate: boolean) {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/account-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          accountName: name.trim(),
          phone: phone.trim() || undefined,
          siteCity: location.trim() || undefined,
          asLead: true,
          ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
        }),
      });
      if (res.status === 409) {
        // A similar lead/company may already exist — surface it, let them confirm.
        setDupWarn(true);
        return;
      }
      if (!res.ok) {
        toast.error("Could not create lead");
        return;
      }
      toast.success(`Lead "${name.trim()}" added`);
      setShowAdd(false);
      resetAdd();
      router.refresh();
    } catch {
      // Network/transient failure — surface it instead of leaving the button
      // stuck on "Adding..." with Cancel disabled (the finally re-enables both).
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

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
        action={
          <button
            onClick={() => {
              resetAdd();
              setShowAdd(true);
            }}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-semibold px-3.5 py-2 rounded-xl text-sm"
          >
            + Add Lead
          </button>
        }
      />

      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or company..."
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-xs focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-slate-200">
              <th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold text-slate-500">Name</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold text-slate-500">Company</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold text-slate-500">Phone</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold text-slate-500">Status</th>
              <th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold text-slate-500 text-right"><span className="sr-only">Actions</span></th>
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

      {showAdd && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !saving && setShowAdd(false)}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Add Lead</h2>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none" aria-label="Close">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name <span className="text-red-500">*</span></label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => { setName(e.target.value); setDupWarn(false); }}
                  placeholder="e.g. Ravi Kumar"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Location</label>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Salem"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green"
                />
              </div>
            </div>
            {dupWarn && (
              <div className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                A similar lead or company may already exist. Click &ldquo;Add anyway&rdquo; to create it regardless.
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowAdd(false)}
                disabled={saving}
                className="px-3.5 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => submitLead(dupWarn)}
                disabled={saving || !name.trim()}
                className="bg-wa-green hover:bg-wa-green/90 text-white font-semibold px-3.5 py-2 rounded-xl text-sm disabled:opacity-50"
              >
                {saving ? "Adding..." : dupWarn ? "Add anyway" : "Add lead"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
