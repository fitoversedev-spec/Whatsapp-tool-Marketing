"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import BackButton from "@/components/BackButton";
import UnifiedTimeline from "@/components/crm/UnifiedTimeline";
import type { TimelineEntry } from "@/lib/crm/timeline";

type Account = {
  id: string;
  name: string;
  city: string | null;
  businessType: string | null;
  gstin: string | null;
  notes: string | null;
  customerProfileId: string | null;
  customerProfileName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
};
type Contact = { id: string; name: string; phone: string | null; email: string | null; designation: string | null; isPrimary: boolean };
type Deal = { id: string; code: string; title: string; quotedValue: number | null; wonValue: number | null; stageName: string; stageColorHex: string | null };
type ActivityRow = { id: string; subject: string; notes: string | null; occurredAt: string; typeName: string; ownerName: string; dealId: string | null };
type Option = { id: string; name: string };

function fmtInr(n: number | null): string {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SECTIONS = [
  { id: "details", label: "Details" },
  { id: "contacts", label: "Contacts" },
  { id: "deals", label: "Deals" },
  { id: "activities", label: "Activities" },
];

export default function CompanyDetailClient({
  isAdmin,
  account,
  contacts,
  deals,
  activities,
  customerProfiles,
  users,
  timeline,
}: {
  isAdmin: boolean;
  account: Account;
  contacts: Contact[];
  deals: Deal[];
  activities: ActivityRow[];
  customerProfiles: Option[];
  users: Option[];
  timeline: TimelineEntry[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"overview" | "timeline">("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [showNewContact, setShowNewContact] = useState(false);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-1.5">
        <BackButton backHref="/crm/companies" />
      </div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-wa-green/15 text-wa-dark font-semibold flex items-center justify-center shrink-0">
            {initials(account.name)}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-slate-900 truncate">{account.name}</h1>
            <p className="text-sm text-slate-600">Owner: {account.ownerName ?? "Unassigned"}</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setShowEdit(true)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Quick actions — attach a new quotation/court design to this company's most recent deal */}
      {deals.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <Link
            href={`/quotations?dealId=${deals[0].id}&customerName=${encodeURIComponent(account.name)}`}
            className="text-xs font-medium border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5"
          >
            <span>📄</span> New Quotation
          </Link>
          <Link
            href={`/court-images?dealId=${deals[0].id}&customerName=${encodeURIComponent(account.name)}`}
            className="text-xs font-medium border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5"
          >
            <span>🎨</span> New Court Design
          </Link>
        </div>
      )}

      {/* Overview / Timeline tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-5">
        {(["overview", "timeline"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? "border-wa-green text-wa-dark" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t === "overview" ? "Overview" : "Timeline"}
          </button>
        ))}
      </div>

      {tab === "timeline" ? (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <UnifiedTimeline entries={timeline} />
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Left rail — jumps to sections below */}
          <nav className="hidden lg:block w-40 shrink-0 sticky top-4 self-start space-y-0.5">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block px-2.5 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {s.label}
              </a>
            ))}
          </nav>

          <div className="flex-1 min-w-0 space-y-4">
            {/* Key-field summary */}
            <div id="details" className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm scroll-mt-4">
              <div><div className="text-xs text-slate-600">City</div><div className="font-medium text-slate-900">{account.city ?? "—"}</div></div>
              <div><div className="text-xs text-slate-600">Segment</div><div className="font-medium text-slate-900">{account.customerProfileName ?? "—"}</div></div>
              <div><div className="text-xs text-slate-600">Business type</div><div className="font-medium text-slate-900">{account.businessType ?? "—"}</div></div>
              <div><div className="text-xs text-slate-600">GSTIN</div><div className="font-medium text-slate-900">{account.gstin ?? "—"}</div></div>
              <div className="col-span-2 sm:col-span-3"><div className="text-xs text-slate-600">Notes</div><div className="text-slate-700">{account.notes ?? "—"}</div></div>
            </div>

            {/* Contacts */}
            <div id="contacts" className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-slate-900">Contacts <span className="text-slate-400 font-normal">{contacts.length}</span></h3>
                <button onClick={() => setShowNewContact(true)} className="text-xs font-medium text-wa-dark hover:underline">+ New contact</button>
              </div>
              {contacts.length === 0 ? (
                <p className="text-sm text-slate-400">No contacts yet.</p>
              ) : (
                <div className="space-y-2">
                  {contacts.map((c) => (
                    <Link
                      key={c.id}
                      href={`/crm/contacts/${c.id}`}
                      className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {c.name} {c.isPrimary && <span className="text-[10px] font-semibold text-wa-dark bg-wa-green/10 px-1.5 py-0.5 rounded ml-1">PRIMARY</span>}
                        </div>
                        <div className="text-xs text-slate-600">{c.designation ?? "—"}</div>
                      </div>
                      <div className="text-xs text-slate-600">{c.phone ?? c.email ?? "—"}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Deals */}
            <div id="deals" className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
              <h3 className="text-base font-semibold text-slate-900 mb-3">Deals <span className="text-slate-400 font-normal">{deals.length}</span></h3>
              {deals.length === 0 ? (
                <p className="text-sm text-slate-400">No deals yet.</p>
              ) : (
                <div className="space-y-2">
                  {deals.map((d) => (
                    <Link
                      key={d.id}
                      href={`/deals/${d.id}`}
                      className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">{d.title}</div>
                        <div className="text-xs text-slate-600">{d.code}</div>
                      </div>
                      <div className="text-right">
                        <span
                          className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full mb-0.5"
                          style={{ background: (d.stageColorHex ?? "#64748b") + "20", color: d.stageColorHex ?? "#475569" }}
                        >
                          {d.stageName}
                        </span>
                        <div className="text-xs text-slate-600">{fmtInr(d.wonValue ?? d.quotedValue)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Activities */}
            <div id="activities" className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
              <h3 className="text-base font-semibold text-slate-900 mb-3">Activities <span className="text-slate-400 font-normal">{activities.length}</span></h3>
              {activities.length === 0 ? (
                <p className="text-sm text-slate-400">Nothing logged yet — activity logged against this company's deals will show up here.</p>
              ) : (
                <div className="space-y-2">
                  {activities.map((a) => (
                    <div key={a.id} className="border-l-2 border-slate-200 pl-3 py-0.5">
                      <div className="text-sm text-slate-900">
                        <span className="font-medium">{a.typeName}</span> — {a.subject}
                      </div>
                      <div className="text-xs text-slate-600">
                        {new Date(a.occurredAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {a.ownerName}
                        {a.dealId && (
                          <>
                            {" · "}
                            <Link href={`/deals/${a.dealId}`} className="text-wa-dark hover:underline">view deal</Link>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showEdit && (
        <EditCompanyModal
          account={account}
          customerProfiles={customerProfiles}
          isAdmin={isAdmin}
          users={users}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            router.refresh();
          }}
        />
      )}

      {showNewContact && (
        <NewContactModal
          accountId={account.id}
          onClose={() => setShowNewContact(false)}
          onCreated={() => {
            setShowNewContact(false);
            toast.success("Contact added");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EditCompanyModal({
  account, customerProfiles, isAdmin, users, onClose, onSaved,
}: {
  account: Account; customerProfiles: Option[]; isAdmin: boolean; users: Option[];
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [city, setCity] = useState(account.city ?? "");
  const [businessType, setBusinessType] = useState(account.businessType ?? "");
  const [customerProfileId, setCustomerProfileId] = useState(account.customerProfileId ?? "");
  const [gstin, setGstin] = useState(account.gstin ?? "");
  const [notes, setNotes] = useState(account.notes ?? "");
  const [ownerUserId, setOwnerUserId] = useState(account.ownerUserId ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        city: city.trim() || null,
        businessType: businessType || null,
        customerProfileId: customerProfileId || null,
        gstin: gstin.trim() || null,
        notes: notes.trim() || null,
        ...(isAdmin ? { ownerUserId: ownerUserId || null } : {}),
      }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else toast.error("Could not save changes");
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold text-slate-900 mb-4">Edit company</h2>
        <form onSubmit={submit} className="space-y-3">
          <div><label className="text-xs font-medium text-slate-600">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div><label className="text-xs font-medium text-slate-600">City</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div><label className="text-xs font-medium text-slate-600">Business type</label>
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Unspecified</option>
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
              <option value="B2G">B2G</option>
            </select>
          </div>
          <div><label className="text-xs font-medium text-slate-600">Segment</label>
            <select value={customerProfileId} onChange={(e) => setCustomerProfileId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Unspecified</option>
              {customerProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><label className="text-xs font-medium text-slate-600">GSTIN</label>
            <input value={gstin} onChange={(e) => setGstin(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div><label className="text-xs font-medium text-slate-600">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {isAdmin && (
            <div><label className="text-xs font-medium text-slate-600">Owner</label>
              <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewContactModal({ accountId, onClose, onCreated }: { accountId: string; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  async function submit(e: FormEvent, confirmDuplicate = false) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setDuplicate(null);
    const res = await fetch("/api/account-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        designation: designation.trim() || undefined,
        confirmDuplicate,
      }),
    });
    setSubmitting(false);
    if (res.ok) { onCreated(); return; }
    if (res.status === 409) {
      const data = await res.json();
      setDuplicate(data.candidate);
      return;
    }
    toast.error("Could not add contact");
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-5">
        <h2 className="font-semibold text-slate-900 mb-4">New contact</h2>
        <form onSubmit={submit} className="space-y-3">
          <div><label className="text-xs font-medium text-slate-600">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div><label className="text-xs font-medium text-slate-600">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div><label className="text-xs font-medium text-slate-600">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div><label className="text-xs font-medium text-slate-600">Designation</label>
            <input value={designation} onChange={(e) => setDesignation(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {duplicate && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
              Possible duplicate: <strong>{duplicate.name}</strong> already exists at this company.
              <div className="mt-2">
                <button type="button" onClick={(e) => submit(e as unknown as FormEvent, true)} className="text-xs font-medium bg-amber-600 text-white px-2.5 py-1 rounded">
                  Add anyway
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">
              {submitting ? "Adding..." : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
