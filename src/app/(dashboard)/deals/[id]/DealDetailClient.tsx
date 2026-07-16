"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

type Deal = {
  id: string;
  code: string;
  title: string;
  accountName: string;
  accountCity: string | null;
  accountOwnerUserId: string | null;
  accountOwnerName: string | null;
  contacts: { id: string; name: string; phone: string | null; isPrimary: boolean }[];
  ownerUserId: string | null;
  ownerName: string | null;
  stageName: string;
  stageColorHex: string | null;
  leadSourceId: string | null;
  leadSourceName: string | null;
  customerProfileId: string | null;
  customerProfileName: string | null;
  businessType: string | null;
  estimatedValue: number | null;
  wonValue: number | null;
  outcome: string | null;
  lossReasonName: string | null;
  lossReasonNote: string | null;
  siteCity: string | null;
  siteCityTierId: string | null;
  siteCityTierName: string | null;
  siteState: string | null;
  siteAddress: string | null;
  officeId: string | null;
  officeName: string | null;
  primaryContactId: string | null;
  expectedCloseAt: string | null;
  enquiryAt: string;
  siteVisitAt: string | null;
  firstQuotedAt: string | null;
  closedAt: string | null;
};

type StageHistoryRow = {
  id: string;
  fromStageName: string | null;
  toStageName: string;
  changedByName: string;
  changedAt: string;
  durationInFromStageSeconds: number | null;
};

type Activity = {
  id: string;
  typeName: string;
  subject: string;
  notes: string | null;
  occurredAt: string;
  ownerName: string;
};

function fmtInr(n: number | null): string {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "";
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days}d in previous stage`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours}h in previous stage`;
  return `${Math.max(1, Math.floor(seconds / 60))}m in previous stage`;
}

export default function DealDetailClient({
  deal,
  stageHistory,
  activities,
  activityTypes,
  offices,
  cityTiers,
  leadSources,
  customerProfiles,
  isAdmin,
  users,
}: {
  deal: Deal;
  stageHistory: StageHistoryRow[];
  activities: Activity[];
  activityTypes: { id: string; name: string }[];
  offices: { id: string; name: string }[];
  cityTiers: { id: string; name: string }[];
  leadSources: { id: string; name: string }[];
  customerProfiles: { id: string; name: string }[];
  isAdmin: boolean;
  users: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [showLogActivity, setShowLogActivity] = useState(false);
  const [showEditDetails, setShowEditDetails] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete deal ${deal.code}? This removes it from every list and analytics view — its quotations and designs stay on record, just no longer attached to a visible deal.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleted: true }),
    });
    setDeleting(false);
    if (res.ok) {
      toast.success("Deal deleted");
      router.push("/deals");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Delete failed");
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title={deal.title} description={deal.code} backHref="/deals" />
        <div className="mt-1 shrink-0 flex items-center gap-3">
          <button
            onClick={() => setShowEditDetails(true)}
            className="text-xs font-medium text-wa-green hover:underline"
          >
            Edit details
          </button>
          {isAdmin && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mt-4">
        <div className="sm:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Account</h3>
            <div className="text-sm text-slate-700">{deal.accountName}</div>
            {deal.accountCity && <div className="text-xs text-slate-400">{deal.accountCity}</div>}
            {deal.accountOwnerName && <div className="text-xs text-slate-400">Owner: {deal.accountOwnerName}</div>}
            {deal.contacts.map((c) => (
              <div key={c.id} className="text-xs text-slate-500 mt-1">
                {c.name} {c.phone && `· ${c.phone}`} {c.isPrimary && <span className="text-wa-green">(primary)</span>}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">Activity log</h3>
              <button
                onClick={() => setShowLogActivity(true)}
                className="text-xs font-medium text-wa-green hover:underline"
              >
                + Log activity
              </button>
            </div>
            {activities.length === 0 ? (
              <p className="text-sm text-slate-400">No activity logged yet.</p>
            ) : (
              <div className="space-y-3">
                {activities.map((a) => (
                  <div key={a.id} className="text-sm border-l-2 border-slate-200 pl-3">
                    <div className="font-medium text-slate-800">
                      {a.typeName} — {a.subject}
                    </div>
                    {a.notes && <div className="text-slate-500 text-xs mt-0.5">{a.notes}</div>}
                    <div className="text-xs text-slate-400 mt-0.5">
                      {fmtDate(a.occurredAt)} · {a.ownerName}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Stage history</h3>
            {stageHistory.length === 0 ? (
              <p className="text-sm text-slate-400">No stage changes yet.</p>
            ) : (
              <div className="space-y-2">
                {stageHistory.map((h) => (
                  <div key={h.id} className="text-sm flex items-baseline justify-between">
                    <div>
                      <span className="text-slate-400">{h.fromStageName ?? "(start)"}</span>
                      <span className="mx-1.5 text-slate-300">→</span>
                      <span className="font-medium text-slate-800">{h.toStageName}</span>
                    </div>
                    <div className="text-xs text-slate-400 text-right">
                      {fmtDate(h.changedAt)}
                      {h.durationInFromStageSeconds != null && <div>{fmtDuration(h.durationInFromStageSeconds)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Stage</span>
              <span className="font-medium" style={{ color: deal.stageColorHex ?? undefined }}>{deal.stageName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Owner</span>
              <span className="text-slate-800">{deal.ownerName ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Source</span>
              <span className="text-slate-800">{deal.leadSourceName ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Customer type</span>
              <span className="text-slate-800">{deal.customerProfileName ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Business type</span>
              <span className="text-slate-800">{deal.businessType ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Site city</span>
              <span className="text-slate-800">{deal.siteCity ?? "—"}{deal.siteCityTierName ? ` (${deal.siteCityTierName})` : ""}</span>
            </div>
            {deal.siteState && (
              <div className="flex justify-between">
                <span className="text-slate-500">Site state</span>
                <span className="text-slate-800">{deal.siteState}</span>
              </div>
            )}
            {deal.siteAddress && (
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 shrink-0">Site address</span>
                <span className="text-slate-800 text-right">{deal.siteAddress}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-500">Office</span>
              <span className="text-slate-800">{deal.officeName ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Primary contact</span>
              <span className="text-slate-800">{deal.contacts.find((c) => c.id === deal.primaryContactId)?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Expected close</span>
              <span className="text-slate-800">{deal.expectedCloseAt ? new Date(deal.expectedCloseAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
            </div>
            <div className="border-t border-slate-100 pt-2 flex justify-between">
              <span className="text-slate-500">Est. value</span>
              <span className="text-slate-800">{fmtInr(deal.estimatedValue)}</span>
            </div>
            {deal.wonValue != null && (
              <div className="flex justify-between">
                <span className="text-slate-500">Won value</span>
                <span className="font-medium text-wa-green">{fmtInr(deal.wonValue)}</span>
              </div>
            )}
            {deal.outcome && (
              <div className="flex justify-between">
                <span className="text-slate-500">Outcome</span>
                <span className="text-slate-800">{deal.outcome}</span>
              </div>
            )}
            {(deal.lossReasonName || deal.lossReasonNote) && (
              <div className="pt-1 text-xs text-slate-500">{deal.lossReasonName ?? deal.lossReasonNote}</div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 text-sm">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Timeline</h3>
            <div className="flex justify-between"><span className="text-slate-500">Enquiry</span><span>{fmtDate(deal.enquiryAt)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Site visit</span><span>{fmtDate(deal.siteVisitAt)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">First quoted</span><span>{fmtDate(deal.firstQuotedAt)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Closed</span><span>{fmtDate(deal.closedAt)}</span></div>
          </div>
        </div>
      </div>

      {showLogActivity && (
        <LogActivityModal
          dealId={deal.id}
          activityTypes={activityTypes}
          onClose={() => setShowLogActivity(false)}
          onLogged={() => {
            setShowLogActivity(false);
            router.refresh();
          }}
        />
      )}

      {showEditDetails && (
        <EditDealDetailsModal
          deal={deal}
          offices={offices}
          cityTiers={cityTiers}
          leadSources={leadSources}
          customerProfiles={customerProfiles}
          isAdmin={isAdmin}
          users={users}
          onClose={() => setShowEditDetails(false)}
          onSaved={() => {
            setShowEditDetails(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// Editable fields not already reachable elsewhere (stage/value/loss-reason
// come from the pipeline board and won/lost close-out, not here — see
// api/deals/[id]/stage/route.ts). These had columns on Deal/Account since
// Phase 1 but no form ever wrote them (see docs/DECISIONS.md) — this is
// also the only way to CORRECT lead source/customer type/business type
// after the fact without re-submitting a whole new quote, since those are
// otherwise only ever set once, at Deal/Account creation.
function EditDealDetailsModal({
  deal,
  offices,
  cityTiers,
  leadSources,
  customerProfiles,
  isAdmin,
  users,
  onClose,
  onSaved,
}: {
  deal: Deal;
  offices: { id: string; name: string }[];
  cityTiers: { id: string; name: string }[];
  leadSources: { id: string; name: string }[];
  customerProfiles: { id: string; name: string }[];
  isAdmin: boolean;
  users: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [accountName, setAccountName] = useState(deal.accountName);
  const [accountCity, setAccountCity] = useState(deal.accountCity ?? "");
  const [accountOwnerUserId, setAccountOwnerUserId] = useState(deal.accountOwnerUserId ?? "");
  const [siteCity, setSiteCity] = useState(deal.siteCity ?? "");
  const [siteCityTierId, setSiteCityTierId] = useState(deal.siteCityTierId ?? "");
  const [siteState, setSiteState] = useState(deal.siteState ?? "");
  const [siteAddress, setSiteAddress] = useState(deal.siteAddress ?? "");
  const [officeId, setOfficeId] = useState(deal.officeId ?? "");
  const [primaryContactId, setPrimaryContactId] = useState(deal.primaryContactId ?? "");
  const [leadSourceId, setLeadSourceId] = useState(deal.leadSourceId ?? "");
  const [customerProfileId, setCustomerProfileId] = useState(deal.customerProfileId ?? "");
  const [businessType, setBusinessType] = useState(deal.businessType ?? "");
  const [ownerUserId, setOwnerUserId] = useState(deal.ownerUserId ?? "");
  const [expectedCloseAt, setExpectedCloseAt] = useState(deal.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountName: accountName.trim() || deal.accountName,
        accountCity: accountCity.trim() || null,
        siteCity: siteCity.trim() || null,
        siteCityTierId: siteCityTierId || null,
        siteState: siteState.trim() || null,
        siteAddress: siteAddress.trim() || null,
        officeId: officeId || null,
        primaryContactId: primaryContactId || null,
        leadSourceId: leadSourceId || null,
        customerProfileId: customerProfileId || null,
        businessType: businessType || null,
        expectedCloseAt: expectedCloseAt ? new Date(`${expectedCloseAt}T12:00:00`).toISOString() : null,
        // Owner reassignment is admin-only (same rule as reassigning a
        // Conversation) — only include it when this modal actually shows
        // the control, so a sales rep's own PATCH request never carries a
        // field they weren't shown.
        ...(isAdmin ? { ownerUserId: ownerUserId || null, accountOwnerUserId: accountOwnerUserId || null } : {}),
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Deal updated");
      onSaved();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Update failed");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[95vh] overflow-y-auto">
        <div className="p-5 sm:p-6 border-b border-slate-200">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">Edit deal details</h2>
        </div>
        <form onSubmit={submit} className="p-5 sm:p-6 space-y-4">
          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Owner</label>
              <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} className="modal-input">
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Account name</label>
              <input value={accountName} onChange={(e) => setAccountName(e.target.value)} className="modal-input" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Account city</label>
              <input value={accountCity} onChange={(e) => setAccountCity(e.target.value)} className="modal-input" />
            </div>
          </div>
          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Account owner</label>
              <select value={accountOwnerUserId} onChange={(e) => setAccountOwnerUserId(e.target.value)} className="modal-input">
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Site city</label>
              <input value={siteCity} onChange={(e) => setSiteCity(e.target.value)} className="modal-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">City tier</label>
              <select value={siteCityTierId} onChange={(e) => setSiteCityTierId(e.target.value)} className="modal-input">
                <option value="">—</option>
                {cityTiers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Site state</label>
            <input value={siteState} onChange={(e) => setSiteState(e.target.value)} className="modal-input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Site address</label>
            <textarea value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} className="modal-input" rows={2} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Office</label>
            <select value={officeId} onChange={(e) => setOfficeId(e.target.value)} className="modal-input">
              <option value="">—</option>
              {offices.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Primary contact</label>
            <select value={primaryContactId} onChange={(e) => setPrimaryContactId(e.target.value)} className="modal-input">
              <option value="">—</option>
              {deal.contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Lead source</label>
            <select value={leadSourceId} onChange={(e) => setLeadSourceId(e.target.value)} className="modal-input">
              <option value="">—</option>
              {leadSources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Customer type</label>
              <select value={customerProfileId} onChange={(e) => setCustomerProfileId(e.target.value)} className="modal-input">
                <option value="">—</option>
                {customerProfiles.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Business type</label>
              <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="modal-input">
                <option value="">—</option>
                <option value="B2B">B2B</option>
                <option value="B2C">B2C</option>
                <option value="B2G">B2G</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Expected close date</label>
            <input type="date" value={expectedCloseAt} onChange={(e) => setExpectedCloseAt(e.target.value)} className="modal-input" />
          </div>
          <div className="pt-4 border-t border-slate-200 -mx-5 sm:-mx-6 px-5 sm:px-6 flex flex-col sm:flex-row sm:justify-end gap-2">
            <button type="button" onClick={onClose} className="order-2 sm:order-1 px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="order-1 sm:order-2 bg-wa-green hover:bg-wa-green/90 disabled:opacity-40 text-white font-medium px-5 py-2.5 rounded-lg"
            >
              Save
            </button>
          </div>
        </form>
      </div>
      <style jsx>{`
        :global(.modal-input) {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          outline: none;
          font-size: 16px;
        }
        @media (min-width: 640px) {
          :global(.modal-input) { font-size: 14px; }
        }
      `}</style>
    </div>
  );
}

function LogActivityModal({
  dealId,
  activityTypes,
  onClose,
  onLogged,
}: {
  dealId: string;
  activityTypes: { id: string; name: string }[];
  onClose: () => void;
  onLogged: () => void;
}) {
  const toast = useToast();
  const [activityTypeId, setActivityTypeId] = useState(activityTypes[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/deals/${dealId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityTypeId, subject, notes: notes || undefined }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Activity logged");
      onLogged();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to log activity");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[95vh] overflow-y-auto">
        <div className="p-5 sm:p-6 border-b border-slate-200">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">Log activity</h2>
        </div>
        <form onSubmit={submit} className="p-5 sm:p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Type</label>
            <select value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} className="modal-input">
              {activityTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Subject <span className="text-red-500">*</span>
            </label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="modal-input" required autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="modal-input" rows={3} />
          </div>
          <div className="pt-4 border-t border-slate-200 -mx-5 sm:-mx-6 px-5 sm:px-6 flex flex-col sm:flex-row sm:justify-end gap-2">
            <button type="button" onClick={onClose} className="order-2 sm:order-1 px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !subject || !activityTypeId}
              className="order-1 sm:order-2 bg-wa-green hover:bg-wa-green/90 disabled:opacity-40 text-white font-medium px-5 py-2.5 rounded-lg"
            >
              Log
            </button>
          </div>
        </form>
      </div>
      <style jsx>{`
        :global(.modal-input) {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          outline: none;
          font-size: 16px;
        }
        @media (min-width: 640px) {
          :global(.modal-input) { font-size: 14px; }
        }
      `}</style>
    </div>
  );
}
