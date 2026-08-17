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
            className="btn btn-primary"
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
          className="input w-full max-w-xs text-sm"
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Company</th>
              <th>Phone</th>
              <th>Status</th>
              <th className="!text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/crm/contacts/${l.id}`} className="font-medium text-court-700 hover:underline">
                    {l.name}
                  </Link>
                </td>
                <td>
                  <Link href={`/crm/companies/${l.accountId}`} className="text-slate-600 hover:underline">{l.accountName}</Link>
                </td>
                <td className="text-slate-600 font-mono">{l.phone ?? "—"}</td>
                <td>
                  {l.converted ? (
                    <span className="badge bg-green-100 text-green-700">Converted</span>
                  ) : (
                    <span className="badge bg-amber-100 text-amber-700">Open</span>
                  )}
                </td>
                <td className="!text-right">
                  {!l.converted && (
                    <button
                      onClick={() => convertToDeal(l)}
                      disabled={convertingId === l.id}
                      className="btn btn-primary !px-3 !py-1 !text-xs"
                    >
                      {convertingId === l.id ? "Converting..." : "Convert to Deal"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">
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
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Location</label>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Salem"
                  className="input text-sm"
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
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={() => submitLead(dupWarn)}
                disabled={saving || !name.trim()}
                className="btn btn-primary"
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
