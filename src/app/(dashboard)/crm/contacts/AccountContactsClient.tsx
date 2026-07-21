"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import SelectAllCheckbox from "@/components/SelectAllCheckbox";
import DateRangePicker, { defaultDateRange, type DateRange } from "@/components/DateRangePicker";
import { matchesContactFilter } from "@/lib/contacts";

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  designation: string | null;
  fields: Record<string, string>;
  isPrimary: boolean;
  accountId: string;
  accountName: string;
  accountOwnerUserId: string | null;
};
type Option = { id: string; name: string };
type StageOption = { id: string; name: string; colorHex: string | null };

export const DESIGNATIONS = ["Owner / Director", "Principal", "Sports Director / Coach", "Facilities Manager", "Procurement", "Other"];

export default function AccountContactsClient({
  isAdmin,
  contacts,
  accounts,
  leadSources,
  customerProfiles,
  funnelStages,
  users,
  dateRange,
}: {
  isAdmin: boolean;
  contacts: Contact[];
  accounts: Option[];
  leadSources: Option[];
  customerProfiles: Option[];
  funnelStages: StageOption[];
  users: Option[];
  dateRange: DateRange | null;
}) {
  const router = useRouter();
  const toast = useToast();

  function applyDateRange(range: DateRange) {
    router.push(`/crm/contacts?from=${range.from}&to=${range.to}`);
  }
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [filterField, setFilterField] = useState("");
  const [filterCondition, setFilterCondition] = useState<"contains" | "equals" | "not_empty">("contains");
  const [filterValue, setFilterValue] = useState("");

  const knownFieldKeys = Array.from(new Set(contacts.flatMap((c) => Object.keys(c.fields)))).sort();

  const visible = contacts.filter((c) => {
    const matchesSearch =
      !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || c.accountName.toLowerCase().includes(q.trim().toLowerCase());
    const matchesField =
      !filterField || matchesContactFilter(c.fields[filterField], { field: filterField, condition: filterCondition, value: filterValue });
    return matchesSearch && matchesField;
  });

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function syncSelected() {
    setBulkSyncing(true);
    const res = await fetch("/api/account-contacts/sync-to-marketing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: Array.from(selected) }),
    });
    setBulkSyncing(false);
    if (!res.ok) {
      toast.error("Could not sync");
      return;
    }
    const data = await res.json();
    const parts: string[] = [];
    if (data.synced > 0) parts.push(`${data.synced} synced`);
    if (data.skippedNoPhone > 0) parts.push(`${data.skippedNoPhone} skipped — no phone`);
    if (data.skippedForbidden > 0) parts.push(`${data.skippedForbidden} skipped — not yours`);
    if (data.synced > 0) toast.success(parts.join(", "));
    else toast.error(parts.join(", ") || "Nothing synced");
    setSelected(new Set());
  }

  async function reassignSelected() {
    if (!reassignTo) return;
    setReassigning(true);
    // Ownership lives on the Account, not the contact itself — resolve each
    // selected contact's account and PATCH each unique one once, rather than
    // one request per contact (several contacts can share an account).
    const accountIds = Array.from(new Set(contacts.filter((c) => selected.has(c.id)).map((c) => c.accountId)));
    const results = await Promise.all(
      accountIds.map((id) =>
        fetch(`/api/accounts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerUserId: reassignTo }),
        }),
      ),
    );
    setReassigning(false);
    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0) toast.success(`Reassigned ${accountIds.length} compan${accountIds.length === 1 ? "y" : "ies"}`);
    else toast.error(`${failed} of ${accountIds.length} could not be reassigned`);
    setSelected(new Set());
    setReassignTo("");
    router.refresh();
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        large
        title="Contacts"
        description={`${contacts.length} people — separate from the WhatsApp broadcast contact list`}
        action={
          <button
            onClick={() => setShowNew(true)}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm"
          >
            + New Contact
          </button>
        }
      />

      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or company..."
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-xs"
          />
          <DateRangePicker value={dateRange ?? defaultDateRange(30)} onApply={applyDateRange} />
          {dateRange && (
            <button onClick={() => router.push("/crm/contacts")} className="text-xs text-slate-500 hover:underline">
              Clear date filter
            </button>
          )}
          {knownFieldKeys.length > 0 && (
            <>
              <select value={filterField} onChange={(e) => setFilterField(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                <option value="">Filter by custom field...</option>
                {knownFieldKeys.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              {filterField && (
                <>
                  <select value={filterCondition} onChange={(e) => setFilterCondition(e.target.value as typeof filterCondition)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                    <option value="contains">contains</option>
                    <option value="equals">equals</option>
                    <option value="not_empty">is set</option>
                  </select>
                  {filterCondition !== "not_empty" && (
                    <input value={filterValue} onChange={(e) => setFilterValue(e.target.value)} placeholder="Value" className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-32" />
                  )}
                </>
              )}
            </>
          )}
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 bg-wa-green/10 border border-wa-green/30 rounded-lg px-3 py-1.5 flex-wrap">
            <span className="text-sm font-medium text-wa-dark">{selected.size} selected</span>
            <button
              onClick={syncSelected}
              disabled={bulkSyncing}
              className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-3 py-1 rounded-md text-xs disabled:opacity-50"
            >
              {bulkSyncing ? "Syncing..." : `Sync ${selected.size} to WhatsApp Marketing`}
            </button>
            {isAdmin && (
              <div className="flex items-center gap-1.5 border-l border-wa-green/30 pl-2">
                <select
                  value={reassignTo}
                  onChange={(e) => setReassignTo(e.target.value)}
                  className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white"
                >
                  <option value="">Reassign owner to...</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <button
                  onClick={reassignSelected}
                  disabled={reassigning || !reassignTo}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-medium px-3 py-1 rounded-md text-xs disabled:opacity-50"
                >
                  {reassigning ? "Reassigning..." : "Apply"}
                </button>
              </div>
            )}
            <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:underline">
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600 border-b border-slate-200">
              <th className="px-4 py-2.5 font-semibold w-8">
                <SelectAllCheckbox ids={visible.map((c) => c.id)} selected={selected} onChange={setSelected} />
              </th>
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Company</th>
              <th className="px-4 py-2.5 font-semibold">Designation</th>
              <th className="px-4 py-2.5 font-semibold">Phone</th>
              <th className="px-4 py-2.5 font-semibold">Email</th>
              {isAdmin && <th className="px-4 py-2.5 font-semibold">Owner</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} className="rounded" aria-label={`Select ${c.name}`} />
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/crm/contacts/${c.id}`} className="font-medium text-wa-dark hover:underline">
                    {c.name}
                  </Link>
                  {c.isPrimary && <span className="text-[10px] font-semibold text-wa-dark bg-wa-green/10 px-1.5 py-0.5 rounded ml-1.5">PRIMARY</span>}
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/crm/companies/${c.accountId}`} className="text-slate-600 hover:underline">{c.accountName}</Link>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{c.designation ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-600">{c.phone ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-600">{c.email ?? "—"}</td>
                {isAdmin && (
                  <td className="px-4 py-2.5 text-slate-600">
                    {users.find((u) => u.id === c.accountOwnerUserId)?.name ?? "—"}
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-slate-400">No contacts found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewContactModal
          accounts={accounts}
          leadSources={leadSources}
          customerProfiles={customerProfiles}
          funnelStages={funnelStages}
          onClose={() => setShowNew(false)}
          onCreated={(id, dealId) => {
            setShowNew(false);
            toast.success(dealId ? "Lead captured — contact and deal created" : "Contact created");
            router.push(`/crm/contacts/${id}`);
          }}
        />
      )}
    </div>
  );
}

function NewContactModal({
  accounts, leadSources, customerProfiles, funnelStages, onClose, onCreated,
}: {
  accounts: Option[]; leadSources: Option[]; customerProfiles: Option[]; funnelStages: StageOption[];
  onClose: () => void; onCreated: (id: string, dealId: string | null) => void;
}) {
  const toast = useToast();
  // Most contacts are individuals, not organizations — asking "which company"
  // as the first question forced a name onto every solo walk-in customer.
  // Defaults closed: a lightweight account is auto-created from the
  // contact's own name. Only the rare real multi-contact org (a school, a
  // hotel chain) needs this expanded — see docs/DECISIONS.md.
  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [companyMode, setCompanyMode] = useState<"existing" | "new">(accounts.length ? "existing" : "new");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [accountName, setAccountName] = useState("");
  const [siteCity, setSiteCity] = useState("");
  const [customerProfileId, setCustomerProfileId] = useState("");
  const [businessType, setBusinessType] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState(DESIGNATIONS[0]);
  const [designationOther, setDesignationOther] = useState("");

  const [leadSourceId, setLeadSourceId] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [dealStageId, setDealStageId] = useState("");
  const [notes, setNotes] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [newFieldKey, setNewFieldKey] = useState("");

  function addField() {
    if (!newFieldKey.trim()) return;
    setFields((prev) => ({ ...prev, [newFieldKey.trim()]: "" }));
    setNewFieldKey("");
  }

  function removeField(key: string) {
    setFields((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  const isCustomerTypeOther = customerProfiles.find((p) => p.id === customerProfileId)?.name.toLowerCase() === "other";
  const [customerTypeOther, setCustomerTypeOther] = useState("");
  // businessType itself stays a strict B2B/B2C/B2G enum (other code groups
  // Accounts by it — a free-text value would fragment that bucketing), so
  // "Other" here is a UI-only sentinel: send no businessType at all and
  // fold the free text into notes, same as Customer type's own "Other".
  const isBusinessTypeOther = businessType === "Other";
  const [businessTypeOther, setBusinessTypeOther] = useState("");

  async function submit(e: FormEvent, confirmDuplicate = false) {
    e.preventDefault();
    if (!name.trim()) return;
    if (showOrgPicker) {
      if (companyMode === "existing" && !accountId) { toast.error("Pick a company"); return; }
      if (companyMode === "new" && !accountName.trim()) { toast.error("Enter a company name"); return; }
    }
    setSubmitting(true);
    setDuplicate(null);

    const resolvedDesignation = designation === "Other" ? designationOther.trim() || undefined : designation;

    // No organization picked — auto-create a lightweight account from the
    // contact's own name rather than asking "which company" for a solo
    // individual customer. POST /api/account-contacts already supports this
    // exact inline-creation path via accountName.
    const res = await fetch("/api/account-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(showOrgPicker
          ? companyMode === "existing"
            ? { accountId }
            : { accountName: accountName.trim() }
          : { accountName: name.trim() }),
        siteCity: siteCity.trim() || undefined,
        customerProfileId: customerProfileId || undefined,
        businessType: isBusinessTypeOther ? undefined : businessType || undefined,
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        designation: resolvedDesignation,
        leadSourceId: leadSourceId || undefined,
        fields,
        notes: [
          sourceDetail.trim() ? `Source detail: ${sourceDetail.trim()}` : "",
          isCustomerTypeOther && customerTypeOther.trim() ? `Customer type detail: ${customerTypeOther.trim()}` : "",
          isBusinessTypeOther && businessTypeOther.trim() ? `Business type detail: ${businessTypeOther.trim()}` : "",
          notes.trim(),
        ].filter(Boolean).join("\n\n") || undefined,
        dealStageId: dealStageId || undefined,
        confirmDuplicate,
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.contact.id, data.dealId);
      return;
    }
    if (res.status === 409) {
      const data = await res.json();
      setDuplicate(data.candidate);
      return;
    }
    const err = await res.json().catch(() => ({}));
    toast.error(err.error ?? "Could not create contact");
  }

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      <div className="shrink-0 border-b border-slate-200 px-4 sm:px-6 py-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">New contact</h2>
          <p className="text-sm text-slate-600 mt-0.5">Capture a person and — if you know where they stand — a deal, all at once.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 text-xl leading-none px-1">
          ×
        </button>
      </div>
      <form onSubmit={submit} className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6">
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide border-b border-slate-100 pb-1.5">Contact details</h3>
                <div><label className="text-xs font-medium text-slate-600">Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-slate-600">Phone</label>
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div><label className="text-xs font-medium text-slate-600">Email</label>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div><label className="text-xs font-medium text-slate-600">Designation</label>
                  <select value={designation} onChange={(e) => setDesignation(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                    {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  {designation === "Other" && (
                    <input value={designationOther} onChange={(e) => setDesignationOther(e.target.value)} placeholder="Enter designation" className="mt-1.5 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide border-b border-slate-100 pb-1.5">Location &amp; organization</h3>
                <div><label className="text-xs font-medium text-slate-600">Location</label>
                  <input value={siteCity} onChange={(e) => setSiteCity(e.target.value)} placeholder="City / site location" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                {!showOrgPicker ? (
                  <button type="button" onClick={() => setShowOrgPicker(true)} className="text-xs font-medium text-wa-dark hover:underline">
                    + This is part of an existing organization
                  </button>
                ) : (
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-600">Organization</label>
                      <button type="button" onClick={() => setShowOrgPicker(false)} className="text-xs text-slate-400 hover:text-slate-600">
                        Hide
                      </button>
                    </div>
                    <div className="flex gap-2 mt-1 mb-1.5">
                      <button type="button" onClick={() => setCompanyMode("existing")} className={`text-xs px-2.5 py-1 rounded-lg border ${companyMode === "existing" ? "bg-wa-green/10 border-wa-green text-wa-dark font-medium" : "border-slate-200 text-slate-500"}`} disabled={accounts.length === 0}>
                        Existing
                      </button>
                      <button type="button" onClick={() => setCompanyMode("new")} className={`text-xs px-2.5 py-1 rounded-lg border ${companyMode === "new" ? "bg-wa-green/10 border-wa-green text-wa-dark font-medium" : "border-slate-200 text-slate-500"}`}>
                        New organization
                      </button>
                    </div>
                    {companyMode === "existing" ? (
                      <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    ) : (
                      <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Organization name" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide border-b border-slate-100 pb-1.5">Classification</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-slate-600">Customer type</label>
                    <select value={customerProfileId} onChange={(e) => setCustomerProfileId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                      <option value="">Unspecified</option>
                      {customerProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {isCustomerTypeOther && (
                      <input value={customerTypeOther} onChange={(e) => setCustomerTypeOther(e.target.value)} placeholder="Describe the customer type" className="mt-1.5 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                    )}
                  </div>
                  <div><label className="text-xs font-medium text-slate-600">Business type</label>
                    <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                      <option value="">Unspecified</option>
                      <option value="B2B">B2B</option>
                      <option value="B2C">B2C</option>
                      <option value="B2G">B2G</option>
                      <option value="Other">Other</option>
                    </select>
                    {isBusinessTypeOther && (
                      <input value={businessTypeOther} onChange={(e) => setBusinessTypeOther(e.target.value)} placeholder="Describe the business type" className="mt-1.5 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide border-b border-slate-100 pb-1.5">Lead source &amp; pipeline</h3>
                <div><label className="text-xs font-medium text-slate-600">Lead source</label>
                  <select value={leadSourceId} onChange={(e) => setLeadSourceId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">Unspecified</option>
                    {leadSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <input value={sourceDetail} onChange={(e) => setSourceDetail(e.target.value)} placeholder="Campaign / referrer name (optional)" className="mt-1.5 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div><label className="text-xs font-medium text-slate-600">Lead stage</label>
                  <select value={dealStageId} onChange={(e) => setDealStageId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">Don't create a deal yet</option>
                    {funnelStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {dealStageId && <p className="text-[11px] text-slate-400 mt-1">A deal will be created for this contact at this stage.</p>}
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide border-b border-slate-100 pb-1.5">Notes</h3>
              <div><label className="text-xs font-medium text-slate-600">What does this lead want?</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. Wants a football turf, ~10,000 sqft, budget around 8L" className="mt-1 w-full max-w-2xl border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide border-b border-slate-100 pb-1.5">Custom fields</h3>
              <div className="max-w-2xl space-y-2">
                {Object.keys(fields).map((k) => (
                  <div key={k} className="flex gap-2 items-center">
                    <span className="text-xs text-slate-600 w-28 shrink-0 truncate" title={k}>{k}</span>
                    <input
                      value={fields[k] ?? ""}
                      onChange={(e) => setFields((prev) => ({ ...prev, [k]: e.target.value }))}
                      className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <button type="button" onClick={() => removeField(k)} aria-label={`Remove ${k}`} className="text-slate-400 hover:text-red-600 text-xs shrink-0 px-1">
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 items-center">
                  <input
                    value={newFieldKey}
                    onChange={(e) => setNewFieldKey(e.target.value)}
                    placeholder="New field name (e.g. Sports requested)"
                    className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  />
                  <button type="button" onClick={addField} className="px-2.5 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg font-medium text-slate-700 shrink-0">
                    + Field
                  </button>
                </div>
              </div>
            </div>

            {duplicate && (
              <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                Possible duplicate: <strong>{duplicate.name}</strong> already exists.
                <div className="mt-2">
                  <button type="button" onClick={(e) => submit(e as unknown as FormEvent, true)} className="text-xs font-medium bg-amber-600 text-white px-2.5 py-1 rounded">
                    Create anyway
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 px-4 sm:px-6 py-3">
          <div className="max-w-6xl mx-auto flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700">Cancel</button>
            <button type="submit" disabled={submitting} className="px-5 py-2 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
