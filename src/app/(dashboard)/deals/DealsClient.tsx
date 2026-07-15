"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

type Deal = {
  id: string;
  code: string;
  title: string;
  accountName: string;
  accountCity: string | null;
  stageId: string;
  stageName: string;
  stageType: string;
  stageColorHex: string | null;
  ownerName: string | null;
  estimatedValue: number | null;
  quotedValue: number | null;
  wonValue: number | null;
  outcome: string | null;
  siteCity: string | null;
  createdAt: string;
  updatedAt: string;
};

type Stage = { id: string; name: string; slug: string; stageType: string; colorHex: string | null; requiresLossReason: boolean };
type Option = { id: string; name: string };
type ProductOption = { id: string; name: string; type: string };

function fmtInr(n: number | null): string {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function StageBadge({ name, colorHex }: { name: string; colorHex: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: (colorHex ?? "#64748b") + "20", color: colorHex ?? "#475569" }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: colorHex ?? "#64748b" }} />
      {name}
    </span>
  );
}

export default function DealsClient({
  currentUserId,
  isAdmin,
  deals,
  stages,
  leadSources,
  customerProfiles,
  users,
  products,
}: {
  currentUserId: string;
  isAdmin: boolean;
  deals: Deal[];
  stages: Stage[];
  leadSources: Option[];
  customerProfiles: Option[];
  users: Option[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [showNew, setShowNew] = useState(false);
  const [closeoutFor, setCloseoutFor] = useState<{ deal: Deal; stage: Stage } | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");

  const visible = ownerFilter === "all" ? deals : deals.filter((d) => d.ownerName === users.find((u) => u.id === ownerFilter)?.name);

  async function changeStage(deal: Deal, stage: Stage, extra?: { wonValue?: number; lossReasonNote?: string }) {
    const res = await fetch(`/api/deals/${deal.id}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStageId: stage.id, ...extra }),
    });
    if (res.ok) {
      toast.success(`${deal.code} moved to ${stage.name}`);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Could not change stage");
    }
  }

  function onStagePick(deal: Deal, stageId: string) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    if (stage.stageType === "won" || stage.requiresLossReason) {
      setCloseoutFor({ deal, stage });
    } else {
      changeStage(deal, stage);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Deals"
        action={
          <button
            onClick={() => setShowNew(true)}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm"
          >
            + New Deal
          </button>
        }
      />

      {isAdmin && (
        <div className="mb-3">
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="all">All owners</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 font-medium">Deal</th>
              <th className="px-4 py-2.5 font-medium">Account</th>
              <th className="px-4 py-2.5 font-medium">Stage</th>
              <th className="px-4 py-2.5 font-medium">Owner</th>
              <th className="px-4 py-2.5 font-medium text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No deals yet — click "New Deal" to create one.
                </td>
              </tr>
            )}
            {visible.map((d) => (
              <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/deals/${d.id}`} className="font-medium text-slate-900 hover:text-wa-green hover:underline">
                    {d.title}
                  </Link>
                  <div className="text-xs text-slate-400">{d.code}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-slate-700">{d.accountName}</div>
                  {d.accountCity && <div className="text-xs text-slate-400">{d.accountCity}</div>}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={d.stageId}
                    onChange={(e) => onStagePick(d, e.target.value)}
                    className="text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white"
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <div className="mt-1"><StageBadge name={d.stageName} colorHex={d.stageColorHex} /></div>
                </td>
                <td className="px-4 py-3 text-slate-600">{d.ownerName ?? "—"}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-900">
                  {fmtInr(d.wonValue ?? d.quotedValue ?? d.estimatedValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewDealModal
          leadSources={leadSources}
          customerProfiles={customerProfiles}
          products={products}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            router.refresh();
          }}
        />
      )}

      {closeoutFor && (
        <CloseoutModal
          deal={closeoutFor.deal}
          stage={closeoutFor.stage}
          onClose={() => setCloseoutFor(null)}
          onConfirm={(extra) => {
            changeStage(closeoutFor.deal, closeoutFor.stage, extra);
            setCloseoutFor(null);
          }}
        />
      )}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[95vh] overflow-y-auto">
        <div className="p-5 sm:p-6 border-b border-slate-200">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">{title}</h2>
        </div>
        <div className="p-5 sm:p-6 space-y-4">{children}</div>
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

function ModalActions({
  confirmLabel,
  confirmDisabled,
  onClose,
  onConfirm,
}: {
  confirmLabel: string;
  confirmDisabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="pt-4 border-t border-slate-200 -mx-5 sm:-mx-6 px-5 sm:px-6 flex flex-col sm:flex-row sm:justify-end gap-2">
      <button type="button" onClick={onClose} className="order-2 sm:order-1 px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-lg">
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={confirmDisabled}
        className="order-1 sm:order-2 bg-wa-green hover:bg-wa-green/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-lg"
      >
        {confirmLabel}
      </button>
    </div>
  );
}

type DuplicateCandidate = { id: string; name: string; city: string | null };

function NewDealModal({
  leadSources,
  customerProfiles,
  products,
  onClose,
  onCreated,
}: {
  leadSources: Option[];
  customerProfiles: Option[];
  products: ProductOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [accountName, setAccountName] = useState("");
  const [city, setCity] = useState("");
  const [customerProfileId, setCustomerProfileId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [leadSourceId, setLeadSourceId] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [interestedProductIds, setInterestedProductIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateCandidate | null>(null);

  function toggleProduct(id: string) {
    setInterestedProductIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function submit(confirmDuplicate = false) {
    setSaving(true);
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        account: { name: accountName, city: city || undefined, customerProfileId: customerProfileId || undefined },
        contactName: contactName || undefined,
        contactPhone: contactPhone || undefined,
        leadSourceId: leadSourceId || undefined,
        estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
        interestedProductIds: interestedProductIds.length ? interestedProductIds : undefined,
        confirmDuplicate,
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Deal created");
      onCreated();
      return;
    }
    const err = await res.json().catch(() => ({}));
    if (res.status === 409 && err.candidate) {
      setDuplicate(err.candidate);
      return;
    }
    toast.error(typeof err.error === "string" ? err.error : "Create failed");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(false);
  }

  if (duplicate) {
    return (
      <ModalShell title="Possible duplicate account" onClose={onClose}>
        <p className="text-sm text-slate-600">
          An account named <strong>{duplicate.name}</strong>
          {duplicate.city ? ` in ${duplicate.city}` : ""} already exists. Is this the same customer?
        </p>
        <div className="pt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={saving}
            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
          >
            No — create a new account anyway
          </button>
          <button type="button" onClick={onClose} className="w-full px-4 py-2.5 text-slate-500 hover:bg-slate-50 rounded-lg">
            Cancel and use the existing account instead
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="New deal" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Deal title <span className="text-red-500">*</span>
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Football turf — St. Xavier's, Coimbatore"
            className="modal-input"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Account name <span className="text-red-500">*</span>
            </label>
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} className="modal-input" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">City</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} className="modal-input" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Customer type</label>
          <select value={customerProfileId} onChange={(e) => setCustomerProfileId(e.target.value)} className="modal-input">
            <option value="">—</option>
            {customerProfiles.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Contact name</label>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="modal-input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Contact phone</label>
            <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="modal-input" />
          </div>
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
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Estimated value (₹)</label>
          <input
            type="number"
            min={0}
            value={estimatedValue}
            onChange={(e) => setEstimatedValue(e.target.value)}
            className="modal-input"
          />
        </div>
        {products.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Interested in <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <div className="border border-slate-300 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100">
              {products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={interestedProductIds.includes(p.id)}
                    onChange={() => toggleProduct(p.id)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-slate-700">{p.name}</span>
                  <span className="text-xs text-slate-400 ml-auto">{p.type}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <ModalActions confirmLabel="Create deal" confirmDisabled={saving || !title || !accountName} onClose={onClose} onConfirm={() => submit(false)} />
      </form>
    </ModalShell>
  );
}

function CloseoutModal({
  deal,
  stage,
  onClose,
  onConfirm,
}: {
  deal: Deal;
  stage: Stage;
  onClose: () => void;
  onConfirm: (extra: { wonValue?: number; lossReasonNote?: string }) => void;
}) {
  const [wonValue, setWonValue] = useState(deal.estimatedValue?.toString() ?? "");
  const [lossReasonNote, setLossReasonNote] = useState("");

  const needsValue = stage.stageType === "won";
  const needsReason = stage.requiresLossReason;
  const canConfirm = (!needsValue || !!wonValue) && (!needsReason || !!lossReasonNote.trim());

  return (
    <ModalShell title={`Move ${deal.code} to "${stage.name}"`} onClose={onClose}>
      {needsValue && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Won value (₹) <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min={0}
            value={wonValue}
            onChange={(e) => setWonValue(e.target.value)}
            className="modal-input"
            autoFocus
          />
        </div>
      )}
      {needsReason && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={lossReasonNote}
            onChange={(e) => setLossReasonNote(e.target.value)}
            className="modal-input"
            rows={3}
            autoFocus
          />
        </div>
      )}
      <ModalActions
        confirmLabel="Confirm"
        confirmDisabled={!canConfirm}
        onClose={onClose}
        onConfirm={() =>
          onConfirm({
            wonValue: needsValue ? Number(wonValue) : undefined,
            lossReasonNote: needsReason ? lossReasonNote.trim() : undefined,
          })
        }
      />
    </ModalShell>
  );
}
