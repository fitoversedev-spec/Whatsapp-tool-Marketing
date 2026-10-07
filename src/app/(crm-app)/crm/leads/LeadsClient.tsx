"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { DropdownFilter, type DropdownOption } from "@/components/DropdownFilter";
import SelectAllCheckbox from "@/components/SelectAllCheckbox";
import WonDealModal from "@/components/crm/WonDealModal";
import { safeFetch } from "@/lib/safe-fetch";

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  accountId: string;
  accountName: string;
  location: string | null;
  leadSource: string | null;
  converted: boolean;
  leadStageId: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  // May this viewer change the lead (its stage)?
  canEdit: boolean;
  // Soonest pending reminder on this person, and how many are pending.
  nextReminder: { message: string; dueAt: string; count: number } | null;
};
type LeadStageOption = { id: string; name: string; colorHex: string | null; isActive: boolean };
type RepOption = { id: string; name: string };

function fmtDue(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// Location options grouped ignoring case/spacing ("salem" + "Salem" → one),
// shown with the first spelling seen — same rule as the Meta leads City filter.
function cityOptions(leads: Lead[]): DropdownOption[] {
  const m = new Map<string, DropdownOption>();
  for (const l of leads) {
    const raw = (l.location ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const cur = m.get(key);
    if (cur) cur.count += 1;
    else m.set(key, { label: raw, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function ReminderCell({ r }: { r: Lead["nextReminder"] }) {
  if (!r) return <span className="text-slate-400">—</span>;
  const overdue = new Date(r.dueAt).getTime() < Date.now();
  return (
    <div className="min-w-0 max-w-[200px]">
      <div className={`text-xs font-mono ${overdue ? "text-red-600 font-semibold" : "text-slate-700"}`}>
        {overdue ? "Overdue · " : ""}{fmtDue(r.dueAt)}
      </div>
      <div className="text-xs text-slate-500 truncate" title={r.message}>{r.message}</div>
      {r.count > 1 && <div className="text-[11px] text-slate-400">+{r.count - 1} more</div>}
    </div>
  );
}

export default function LeadsClient({ leads, leadStages, reps }: { leads: Lead[]; leadStages: LeadStageOption[]; reps: RepOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [savingStageId, setSavingStageId] = useState<string | null>(null);
  // "Move to deal" — confirm the project: creates the deal and moves the lead to Deals.
  const [wonFor, setWonFor] = useState<Lead | null>(null);
  const cities = useMemo(() => cityOptions(leads), [leads]);

  // Ticked leads, for "Remove from Leads". Cleared whenever the filters
  // change, so it never acts on rows that aren't on screen.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    setSelected(new Set());
  }, [q, cityFilter, repFilter, stageFilter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Takes the ticked leads out of Leads — same as "Remove from Leads" on a
  // contact page: they stay in Contacts with their stage, notes and
  // reminders, and "Move to Leads" there brings them back. Leads this viewer
  // can't edit are skipped by the server (and can't be ticked here anyway).
  async function removeSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    setRemoving(true);
    let updated = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const res = await safeFetch("/api/account-contacts/bulk-pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactIds: ids.slice(i, i + 200), pipelineStage: null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? "Could not remove leads");
          return;
        }
        updated += data.updated ?? 0;
        skipped += data.skippedForbidden ?? 0;
      }
      toast.success(
        `Removed ${updated} lead${updated === 1 ? "" : "s"} from Leads${skipped ? ` · ${skipped} skipped (not yours to edit)` : ""}`
      );
      setSelected(new Set());
      setConfirmRemove(false);
      router.refresh();
    } finally {
      setRemoving(false);
    }
  }

  async function changeStage(lead: Lead, stageId: string) {
    setSavingStageId(lead.id);
    const res = await fetch(`/api/account-contacts/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadStageId: stageId || null }),
    });
    setSavingStageId(null);
    if (res.ok) {
      toast.success(`${lead.name}: ${leadStages.find((s) => s.id === stageId)?.name ?? "stage cleared"}`);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Could not change stage");
    }
  }

  function stageSelect(l: Lead, className: string) {
    const current = leadStages.find((s) => s.id === l.leadStageId) ?? null;
    return (
      <select
        value={l.leadStageId ?? ""}
        onChange={(e) => changeStage(l, e.target.value)}
        disabled={!l.canEdit || savingStageId === l.id}
        aria-label={`Stage for ${l.name}`}
        className={`text-xs font-semibold rounded-full border-0 px-2.5 py-1 disabled:opacity-70 ${className}`}
        style={{ background: (current?.colorHex ?? "#64748b") + "20", color: current?.colorHex ?? "#475569" }}
      >
        <option value="" style={{ color: "#475569" }}>No stage</option>
        {leadStages
          .filter((s) => s.isActive || s.id === l.leadStageId)
          .map((s) => (
            // Own color per option — otherwise every option inherits the
            // current stage's inline color from the <select>.
            <option key={s.id} value={s.id} disabled={!s.isActive} style={{ color: s.colorHex ?? "#475569" }}>{s.name}</option>
          ))}
      </select>
    );
  }

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

  const qt = q.trim().toLowerCase();
  const cityQ = cityFilter.trim().toLowerCase();
  const visible = leads.filter(
    (l) =>
      (!qt ||
        l.name.toLowerCase().includes(qt) ||
        l.accountName.toLowerCase().includes(qt) ||
        (l.location?.toLowerCase().includes(qt) ?? false) ||
        (l.leadSource?.toLowerCase().includes(qt) ?? false)) &&
      // Substring, like the Meta leads City filter: "Salem" also finds "Salem Bellur".
      (!cityQ || (l.location ?? "").toLowerCase().includes(cityQ)) &&
      (!repFilter || (repFilter === "__none__" ? !l.ownerUserId : l.ownerUserId === repFilter)) &&
      (!stageFilter || (stageFilter === "__none__" ? !l.leadStageId : l.leadStageId === stageFilter)),
  );
  const filtering = !!(qt || cityQ || repFilter || stageFilter);
  // Only leads this viewer may edit can be ticked.
  const selectableIds = visible.filter((l) => l.canEdit).map((l) => l.id);

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

      <div className="mb-3 flex items-end gap-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or company..."
          className="input w-full max-w-xs text-sm"
          data-guide="crm-leads-search"
        />
        <DropdownFilter guide="crm-leads-location" label="Location" value={cityFilter} onChange={setCityFilter} options={cities} />
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Stage</label>
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="input w-44 !py-1.5 text-sm" data-guide="crm-leads-stage-filter">
            <option value="">All stages</option>
            {leadStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="__none__">No stage</option>
          </select>
        </div>
        {reps.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Handled by</label>
            <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="input w-44 !py-1.5 text-sm" data-guide="crm-leads-rep-filter">
              <option value="">All reps</option>
              {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              <option value="__none__">Unassigned</option>
            </select>
          </div>
        )}
        {filtering && (
          <span className="text-xs text-slate-500 pb-2">
            <span className="font-mono">{visible.length}</span> of <span className="font-mono">{leads.length}</span>
            <button onClick={() => { setQ(""); setCityFilter(""); setRepFilter(""); setStageFilter(""); }} className="ml-2 text-court-700 hover:underline">Clear</button>
          </span>
        )}
      </div>

      {selected.size > 0 && (
        <div
          className="sticky top-0 z-20 mb-3 flex items-center gap-3 flex-wrap rounded-xl border border-court-200 bg-court-50 px-4 py-2 text-sm text-court-800"
          data-guide="crm-leads-bulk-bar"
        >
          <span className="font-semibold">{selected.size} selected</span>
          <button
            onClick={() => setConfirmRemove(true)}
            className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            data-guide="crm-leads-remove"
          >
            Remove from Leads
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-court-700 hover:underline">
            Clear
          </button>
        </div>
      )}

      <div className="card">
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {selectableIds.length > 0 && (
            <label className="flex items-center gap-2 px-4 py-2.5 text-xs text-slate-600">
              <SelectAllCheckbox ids={selectableIds} selected={selected} onChange={setSelected} />
              Select all
            </label>
          )}
          {visible.map((l) => (
            <div key={l.id} className={`p-4 ${selected.has(l.id) ? "bg-court-50" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                {l.canEdit && (
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={() => toggle(l.id)}
                    aria-label={`Select ${l.name}`}
                    className="mt-1 rounded shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <Link href={`/crm/contacts/${l.id}`} className="block truncate font-medium text-court-700 hover:underline">
                    {l.name}
                  </Link>
                  <div className="text-xs text-slate-500 truncate mt-0.5">
                    <Link href={`/crm/companies/${l.accountId}`} className="hover:underline">{l.accountName}</Link>
                    <span className="font-mono"> · {l.phone ?? "—"}</span>
                  </div>
                  {(l.location || l.leadSource) && (
                    <div className="text-xs text-slate-400 truncate mt-0.5">
                      {l.location && <span>{l.location}</span>}
                      {l.location && l.leadSource && <span> · </span>}
                      {l.leadSource && <span>{l.leadSource}</span>}
                    </div>
                  )}
                  <div className="text-xs text-slate-500 mt-0.5">Handled by <span className="font-medium text-slate-700">{l.ownerName ?? "Unassigned"}</span></div>
                </div>
                {l.converted && <span className="shrink-0 badge bg-green-100 text-green-700">Converted</span>}
              </div>
              <div className="mt-2 flex items-start justify-between gap-3">
                {stageSelect(l, "")}
                <ReminderCell r={l.nextReminder} />
              </div>
              {l.canEdit && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <button onClick={() => setWonFor(l)} className="w-full rounded-lg py-1.5 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
                    Move to deal
                  </button>
                </div>
              )}
            </div>
          ))}
          {visible.length === 0 && (
            <div className="py-8 text-center text-sm text-slate-400">
              No leads yet — promote a contact from the Contacts list.
            </div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8" data-guide="crm-leads-select-all">
                  <SelectAllCheckbox ids={selectableIds} selected={selected} onChange={setSelected} />
                </th>
                <th>Name</th>
                <th>Company</th>
                <th>Phone</th>
                <th>Location</th>
                <th>Stage</th>
                <th>Handled by</th>
                <th>Reminder</th>
                <th>Lead Source</th>
                <th className="!text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <tr key={l.id} className={selected.has(l.id) ? "bg-court-50" : undefined}>
                  <td>
                    {l.canEdit && (
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggle(l.id)}
                        aria-label={`Select ${l.name}`}
                        className="rounded"
                      />
                    )}
                  </td>
                  <td>
                    <Link href={`/crm/contacts/${l.id}`} className="font-medium text-court-700 hover:underline" data-guide="crm-leads-row-link">
                      {l.name}
                    </Link>
                    {l.converted && <span className="ml-1.5 badge bg-green-100 text-green-700">Converted</span>}
                  </td>
                  <td>
                    <Link href={`/crm/companies/${l.accountId}`} className="text-slate-600 hover:underline">{l.accountName}</Link>
                  </td>
                  <td className="text-slate-600 font-mono">{l.phone ?? "—"}</td>
                  <td className="text-slate-600">{l.location ?? "—"}</td>
                  <td>{stageSelect(l, "")}</td>
                  <td className="text-slate-600 whitespace-nowrap">{l.ownerName ?? <span className="text-slate-400">Unassigned</span>}</td>
                  <td><ReminderCell r={l.nextReminder} /></td>
                  <td className="text-slate-600">{l.leadSource ?? "—"}</td>
                  <td className="!text-right">
                    {l.canEdit && (
                      <button
                        onClick={() => setWonFor(l)}
                        title="Confirmed project — create the deal and move this lead to Deals"
                        className="whitespace-nowrap rounded-lg px-3 py-1 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                        data-guide="crm-leads-convert"
                      >
                        Move to deal
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400">
                    {filtering ? "No leads match these filters." : "No leads yet — promote a contact from the Contacts list."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirmRemove && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !removing && setConfirmRemove(false)}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              Remove {selected.size} lead{selected.size === 1 ? "" : "s"} from Leads?
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              They stay in Contacts with their stage, notes and reminders. Move to Leads on their contact page brings
              them back.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setConfirmRemove(false)} disabled={removing} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={removeSelected}
                disabled={removing}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {removing ? "Removing…" : "Remove from Leads"}
              </button>
            </div>
          </div>
        </div>
      )}

      {wonFor && (
        <WonDealModal
          contact={{ id: wonFor.id, name: wonFor.name }}
          onClose={() => setWonFor(null)}
          onDone={() => { setWonFor(null); router.refresh(); }}
        />
      )}

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
