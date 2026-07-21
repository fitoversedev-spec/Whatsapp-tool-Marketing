"use client";

import { useState, useRef, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import BackButton from "@/components/BackButton";
import UnifiedTimeline from "@/components/crm/UnifiedTimeline";
import { CALL_TYPE_NAMES, MEETING_TYPE_NAMES, type TimelineEntry } from "@/lib/crm/timelineShared";
import { DESIGNATIONS } from "../AccountContactsClient";

type Contact = {
  id: string; name: string; phone: string | null; email: string | null;
  designation: string | null; notes: string | null; fields: Record<string, string>; isPrimary: boolean;
  accountId: string; accountName: string; accountCity: string | null;
  accountCustomerProfileId: string | null; accountBusinessType: string | null;
  createdAt: string;
};
type CustomerProfileOption = { id: string; name: string };
type Deal = {
  id: string; code: string; title: string; quotedValue: number | null; wonValue: number | null;
  estimatedValue: number | null; stageId: string; stageName: string; stageColorHex: string | null;
};
type ActivityRow = { id: string; subject: string; notes: string | null; occurredAt: string; typeName: string; ownerName: string };
type QuotationRow = { id: string; number: string; grandTotal: number; status: string; contactPhone: string | null; sentAt: string | null; createdAt: string };
type CourtImageRow = { id: string; number: string; status: string; imageUrl: string | null; contactPhone: string | null; sentAt: string | null; createdAt: string };
type ProductInterestRow = { id: string; name: string; sportName: string | null };
type ProductOption = { id: string; name: string; type: string };
type ActivityTypeOption = { id: string; name: string };
type StageOption = { id: string; name: string; stageType: string; colorHex: string | null; requiresLossReason: boolean };
type LossReasonOption = { id: string; name: string };
type ContactNoteRow = { id: string; title: string | null; body: string; createdAt: string; authorName: string };
type ReminderRow = {
  id: string; message: string; dueAt: string; completedAt: string | null; completionNote: string | null;
  location: string | null; meetingUrl: string | null; activityTypeName: string | null;
};
type AttachmentRow = { id: string; fileName: string; fileUrl: string; fileSize: number; mimeType: string; createdAt: string; uploadedByName: string };

// A Meeting/Call can exist as a scheduled Reminder (future or completed)
// AND as a logged Activity (already happened, entered via Log Activity) —
// these sections show both together, merged by timestamp, matching how a
// rep actually thinks about "everything about calls with this person"
// rather than splitting by which table it happens to live in.
type TypedTimelineRow = { id: string; kind: "scheduled" | "logged"; title: string; detail: string | null; timestamp: string; completed?: boolean };

// Same convention as QuotationsClient.tsx / CourtImagesClient.tsx (each
// already defines this independently — matching that precedent rather
// than introducing a shared import for one small object).
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-800",
  viewed: "bg-purple-100 text-purple-800",
  accepted: "bg-emerald-100 text-emerald-800",
  expired: "bg-red-100 text-red-800",
};

function fmtInr(n: number | null): string {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SECTIONS = [
  { id: "details", label: "Details" },
  { id: "deals", label: "Deals" },
  { id: "quotations", label: "Quotations" },
  { id: "court-designs", label: "Court Designs" },
  { id: "products", label: "Product interest" },
  { id: "meetings", label: "Meetings" },
  { id: "calls", label: "Calls" },
  { id: "notes", label: "Notes" },
  { id: "attachments", label: "Attachments" },
  { id: "activities", label: "Activities" },
];

export default function ContactDetailClient({
  contact, deals, activities, quotations, courtImages, productInterests, timeline, products, activityTypes, funnelStages, lossReasons, customerProfiles, contactNotes, reminders, attachments,
}: {
  contact: Contact; deals: Deal[]; activities: ActivityRow[]; quotations: QuotationRow[]; courtImages: CourtImageRow[];
  productInterests: ProductInterestRow[]; timeline: TimelineEntry[]; products: ProductOption[];
  activityTypes: ActivityTypeOption[]; funnelStages: StageOption[]; lossReasons: LossReasonOption[];
  customerProfiles: CustomerProfileOption[]; contactNotes: ContactNoteRow[]; reminders: ReminderRow[]; attachments: AttachmentRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"overview" | "timeline">("overview");
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [pendingAction, setPendingAction] = useState<"quote" | "court" | "deal" | "meeting" | "call" | null>(null);
  const [scheduleDealId, setScheduleDealId] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<"meeting" | "call" | null>(null);
  const [completingReminderId, setCompletingReminderId] = useState<string | null>(null);
  const [completionNoteDraft, setCompletionNoteDraft] = useState("");
  const [completingBusy, setCompletingBusy] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [syncing, setSyncing] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [showLogActivity, setShowLogActivity] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  async function submitNote() {
    if (!noteBody.trim()) return;
    setSavingNote(true);
    const res = await fetch(`/api/account-contacts/${contact.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: noteTitle.trim() || undefined, body: noteBody.trim() }),
    });
    setSavingNote(false);
    if (res.ok) {
      setNoteTitle("");
      setNoteBody("");
      setShowAddNote(false);
      toast.success("Note added");
      router.refresh();
    } else {
      toast.error("Could not save note");
    }
  }
  const [closeoutFor, setCloseoutFor] = useState<{ deal: Deal; stage: StageOption } | null>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(contact.name);
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [designation, setDesignation] = useState(contact.designation ?? "");
  const [designationOther, setDesignationOther] = useState("");
  const [siteCity, setSiteCity] = useState(contact.accountCity ?? "");
  const [customerProfileId, setCustomerProfileId] = useState(contact.accountCustomerProfileId ?? "");
  const [businessType, setBusinessType] = useState(contact.accountBusinessType ?? "");
  const [businessTypeOther, setBusinessTypeOther] = useState("");
  const isBusinessTypeOther = businessType === "Other";
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [isPrimary, setIsPrimary] = useState(contact.isPrimary);
  const [fields, setFields] = useState<Record<string, string>>(contact.fields);
  const [newFieldKey, setNewFieldKey] = useState("");

  // Same preset-dropdown-plus-"Other" pattern as the New Contact form: if the
  // stored value matches one of the fixed presets, select it; otherwise it's
  // a free-text value someone typed under "Other" previously.
  function startEdit() {
    setName(contact.name);
    setPhone(contact.phone ?? "");
    setEmail(contact.email ?? "");
    if (contact.designation && DESIGNATIONS.includes(contact.designation)) {
      setDesignation(contact.designation);
      setDesignationOther("");
    } else if (contact.designation) {
      setDesignation("Other");
      setDesignationOther(contact.designation);
    } else {
      setDesignation(DESIGNATIONS[0]);
      setDesignationOther("");
    }
    setSiteCity(contact.accountCity ?? "");
    setCustomerProfileId(contact.accountCustomerProfileId ?? "");
    setBusinessType(contact.accountBusinessType ?? "");
    setBusinessTypeOther("");
    setNotes(contact.notes ?? "");
    setIsPrimary(contact.isPrimary);
    setFields(contact.fields);
    setNewFieldKey("");
    setEditing(true);
  }

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

  async function saveEdit() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const resolvedDesignation = designation === "Other" ? designationOther.trim() || null : designation || null;
    // businessType stays a strict B2B/B2C/B2G enum (other code buckets
    // Accounts by it) — "Other" is sent as no businessType at all, with the
    // free text folded into notes instead, same composition the New Contact
    // form already uses for its own Customer type "Other".
    const resolvedBusinessType = isBusinessTypeOther ? null : businessType || null;
    const composedNotes =
      [
        isBusinessTypeOther && businessTypeOther.trim() ? `Business type detail: ${businessTypeOther.trim()}` : "",
        notes.trim(),
      ].filter(Boolean).join("\n\n") || null;
    const res = await fetch(`/api/account-contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        designation: resolvedDesignation,
        siteCity: siteCity.trim() || null,
        customerProfileId: customerProfileId || null,
        businessType: resolvedBusinessType,
        notes: composedNotes,
        fields,
        isPrimary,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      toast.success("Contact updated");
      router.refresh();
    } else {
      toast.error("Could not save changes");
    }
  }

  async function syncToMarketing() {
    setSyncing(true);
    const res = await fetch("/api/account-contacts/sync-to-marketing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: [contact.id] }),
    });
    setSyncing(false);
    if (!res.ok) { toast.error("Could not sync"); return; }
    const data = await res.json();
    if (data.synced > 0) toast.success("Added to WhatsApp marketing contacts");
    else if (data.skippedNoPhone > 0) toast.error("This contact has no phone number to sync");
    else toast.error("Could not sync");
  }

  // Reuses the same /send endpoints the standalone Quotations/Court Designs
  // list pages already call — first-send and resend are the same request,
  // the API is idempotent about re-using an already-rendered PDF (see
  // its own header comment).
  async function resendQuotation(q: QuotationRow) {
    if (!q.contactPhone) { toast.error("No contact phone on this quotation"); return; }
    // Opened synchronously so browsers don't block it as a popup — its
    // location is set once we know the WhatsApp Web URL (only used for
    // CRM-channel deals; see /api/quotations/[id]/send).
    const pendingTab = window.open("about:blank", "_blank");
    setResending(q.id);
    const res = await fetch(`/api/quotations/${q.id}/send`, { method: "POST" });
    setResending(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { pendingTab?.close(); toast.error(data.error ?? "Send failed"); return; }
    if (data.whatsappWebUrl) {
      if (pendingTab) pendingTab.location.href = data.whatsappWebUrl;
      else window.open(data.whatsappWebUrl, "_blank");
      toast.success(`Quotation ${q.number} ready — send it from the WhatsApp tab that just opened`);
    } else {
      pendingTab?.close();
      toast.success(`Quotation ${q.number} sent`);
    }
    router.refresh();
  }

  async function resendCourtImage(c: CourtImageRow) {
    if (!c.contactPhone) { toast.error("No phone on this design"); return; }
    const pendingTab = window.open("about:blank", "_blank");
    setResending(c.id);
    const res = await fetch(`/api/court-images/${c.id}/send`, { method: "POST" });
    setResending(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { pendingTab?.close(); toast.error(data.message ?? data.error ?? "Send failed"); return; }
    if (data.whatsappWebUrl) {
      if (pendingTab) pendingTab.location.href = data.whatsappWebUrl;
      else window.open(data.whatsappWebUrl, "_blank");
      toast.success(`Design ${c.number} ready — send it from the WhatsApp tab that just opened`);
    } else {
      pendingTab?.close();
      toast.success(`Design ${c.number} sent`);
    }
    router.refresh();
  }

  function goToWizard(kind: "quote" | "court", dealId: string) {
    const params = new URLSearchParams({ dealId, customerName: contact.name });
    if (contact.phone) params.set("phone", contact.phone);
    router.push(`${kind === "quote" ? "/quotations" : "/court-images"}?${params.toString()}`);
  }

  function openSchedule(mode: "meeting" | "call", dealId: string) {
    setScheduleMode(mode);
    setScheduleDealId(dealId);
  }

  function onQuickAction(kind: "quote" | "court" | "product" | "meeting" | "call") {
    if (deals.length === 0) {
      if (kind === "product") { setShowProductPicker(true); return; } // product picker handles deal-creation itself
      setPendingAction(kind);
      return;
    }
    // Multiple deals — default to the most recently updated one (deals is
    // already sorted that way) rather than forcing a picker for the common
    // case; DealDetail is always one click away to pick a different one.
    if (kind === "product") { setShowProductPicker(true); return; }
    if (kind === "meeting" || kind === "call") { openSchedule(kind, deals[0].id); return; }
    goToWizard(kind, deals[0].id);
  }

  async function completeReminder(id: string) {
    setCompletingBusy(true);
    const res = await fetch(`/api/reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true, completionNote: completionNoteDraft.trim() || null }),
    });
    setCompletingBusy(false);
    if (res.ok) {
      setCompletingReminderId(null);
      setCompletionNoteDraft("");
      toast.success("Marked complete");
      router.refresh();
    } else {
      toast.error("Could not update reminder");
    }
  }

  function buildTypedRows(typeNames: Set<string>): TypedTimelineRow[] {
    const scheduled: TypedTimelineRow[] = reminders
      .filter((r) => r.activityTypeName && typeNames.has(r.activityTypeName))
      .map((r) => ({
        id: r.id,
        kind: "scheduled" as const,
        title: r.message,
        detail: r.completedAt ? r.completionNote : r.location ?? r.meetingUrl,
        timestamp: r.dueAt,
        completed: !!r.completedAt,
      }));
    const logged: TypedTimelineRow[] = activities
      .filter((a) => typeNames.has(a.typeName))
      .map((a) => ({ id: a.id, kind: "logged" as const, title: a.subject, detail: a.notes, timestamp: a.occurredAt }));
    return [...scheduled, ...logged].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
  const meetingRows = buildTypedRows(MEETING_TYPE_NAMES);
  const callRows = buildTypedRows(CALL_TYPE_NAMES);

  // Shared renderer for the Meetings/Calls sections — a plain function
  // (not a component) so it closes over the complete-with-note state
  // directly instead of prop-drilling it through.
  function renderTypedSection(sectionId: string, label: string, rows: TypedTimelineRow[], onAdd: () => void) {
    return (
      <div id={sectionId} className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-slate-900">{label} <span className="text-slate-400 font-normal">{rows.length}</span></h3>
          <button onClick={onAdd} aria-label={`Add ${label.toLowerCase()}`} title={`Add ${label.toLowerCase()}`} className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none">
            +
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing here yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={`${r.kind}-${r.id}`} className="rounded-lg border border-slate-100 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                          r.kind === "logged" ? "bg-wa-green/10 text-wa-dark" : r.completed ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {r.kind === "logged" ? "Logged" : r.completed ? "Completed" : "Scheduled"}
                      </span>
                      <span className={`text-sm font-medium ${r.kind === "scheduled" && r.completed ? "text-slate-500 line-through" : "text-slate-900"}`}>{r.title}</span>
                    </div>
                    {r.detail && <div className="text-sm text-slate-600 mt-0.5">{r.detail}</div>}
                    <div className="text-xs text-slate-500 mt-0.5">{fmtDateTime(r.timestamp)}</div>
                  </div>
                  {r.kind === "scheduled" && !r.completed && completingReminderId !== r.id && (
                    <button
                      onClick={() => { setCompletingReminderId(r.id); setCompletionNoteDraft(""); }}
                      className="text-xs font-medium text-wa-dark hover:underline shrink-0"
                    >
                      Mark complete
                    </button>
                  )}
                </div>
                {completingReminderId === r.id && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <textarea
                      value={completionNoteDraft}
                      onChange={(e) => setCompletionNoteDraft(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder="What happened? (optional)"
                      className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <div className="flex gap-2 justify-end mt-1.5">
                      <button onClick={() => setCompletingReminderId(null)} className="text-xs font-medium text-slate-700 px-2 py-1">Cancel</button>
                      <button onClick={() => completeReminder(r.id)} disabled={completingBusy} className="bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50">
                        {completingBusy ? "Saving..." : "Confirm"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  async function uploadAttachment(file: File) {
    setUploadingFile(true);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/account-contacts/${contact.id}/attachments`, { method: "POST", body: form });
    setUploadingFile(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (res.ok) {
      toast.success("File uploaded");
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Upload failed");
    }
  }

  async function deleteAttachment(id: string) {
    if (!confirm("Delete this file? This cannot be undone.")) return;
    const res = await fetch(`/api/account-contacts/${contact.id}/attachments/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("File deleted");
      router.refresh();
    } else {
      toast.error("Could not delete file");
    }
  }

  // Same transitionDeal() endpoint the Deals list uses — this is the sole
  // place allowed to change Deal.currentStageId, so a change made here is
  // already the single source of truth everywhere else reads from (Deal
  // Detail, Deals list, Pipeline, analytics), not a separate copy to sync.
  async function changeStage(deal: Deal, stage: StageOption, extra?: { wonValue?: number; lossReasonId?: string; lossReasonNote?: string }) {
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
    const stage = funnelStages.find((s) => s.id === stageId);
    if (!stage) return;
    if (stage.stageType === "won" || stage.requiresLossReason) {
      setCloseoutFor({ deal, stage });
    } else {
      changeStage(deal, stage);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-1.5">
        <BackButton backHref="/crm/contacts" />
      </div>
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-blue-100 text-blue-800 font-semibold flex items-center justify-center shrink-0">
            {initials(contact.name)}
          </div>
          <div className="min-w-0">
            {editing ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-lg font-semibold text-slate-900 border border-slate-300 rounded-lg px-2 py-1 w-full max-w-xs"
              />
            ) : (
              <h1 className="text-xl font-semibold text-slate-900 truncate">{contact.name}</h1>
            )}
            <p className="text-sm text-slate-600">
              <Link href={`/crm/companies/${contact.accountId}`} className="hover:underline">{contact.accountName}</Link>
              {contact.designation ? ` · ${contact.designation}` : ""}
              {contact.isPrimary && <span className="ml-1.5 text-[10px] font-semibold text-wa-dark bg-wa-green/10 px-1.5 py-0.5 rounded">PRIMARY</span>}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} disabled={saving} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving} className="bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <>
              {contact.phone && (
                <a
                  href={`https://wa.me/${contact.phone.replace(/[^0-9]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-1.5 text-sm font-medium"
                >
                  Send message
                </a>
              )}
              <button
                onClick={syncToMarketing}
                disabled={syncing || !contact.phone}
                title={!contact.phone ? "Add a phone number first" : "Add this person to the WhatsApp marketing contact list"}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                {syncing ? "Syncing..." : "Sync to WhatsApp Marketing"}
              </button>
              <button onClick={startEdit} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Edit
              </button>
            </>
          )}
        </div>
      </div>

      {/* Quick actions — attach a new quotation/court design/product interest against this lead. Deal and Activity each have their own + in their own section below instead. */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => onQuickAction("quote")} className="text-xs font-medium border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5">
          <span>📄</span> New Quotation
        </button>
        <button onClick={() => onQuickAction("court")} className="text-xs font-medium border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5">
          <span>🎨</span> New Court Design
        </button>
        <button onClick={() => onQuickAction("product")} className="text-xs font-medium border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5">
          <span>📦</span> Product interest
        </button>
        <button onClick={() => onQuickAction("meeting")} className="text-xs font-medium border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5">
          <span>📅</span> Schedule Meeting
        </button>
        <button onClick={() => onQuickAction("call")} className="text-xs font-medium border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5">
          <span>📞</span> Schedule Call
        </button>
      </div>

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
          <nav className="hidden lg:block w-40 shrink-0 sticky top-4 self-start space-y-0.5">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="block px-2.5 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                {s.label}
              </a>
            ))}
          </nav>

          <div className="flex-1 min-w-0 space-y-4">
            <div id="details" className="bg-white rounded-xl border border-slate-200 p-4 text-sm scroll-mt-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-slate-600">Phone</div>
                  {editing ? (
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1 text-sm" />
                  ) : (
                    <div className="font-medium text-slate-900">{contact.phone ?? "—"}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-slate-600">Email</div>
                  {editing ? (
                    <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1 text-sm" />
                  ) : (
                    <div className="font-medium text-slate-900">{contact.email ?? "—"}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-slate-600">Designation</div>
                  {editing ? (
                    <>
                      <select value={designation} onChange={(e) => setDesignation(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1 text-sm">
                        {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                      {designation === "Other" && (
                        <input value={designationOther} onChange={(e) => setDesignationOther(e.target.value)} placeholder="Enter designation" className="mt-1.5 w-full border border-slate-300 rounded-lg px-2 py-1 text-sm" />
                      )}
                    </>
                  ) : (
                    <div className="font-medium text-slate-900">{contact.designation ?? "—"}</div>
                  )}
                </div>
                <div><div className="text-xs text-slate-600">Company</div><div className="font-medium text-slate-900">{contact.accountName}</div></div>
                <div>
                  <div className="text-xs text-slate-600">City</div>
                  {editing ? (
                    <input value={siteCity} onChange={(e) => setSiteCity(e.target.value)} placeholder="City / site location" className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1 text-sm" />
                  ) : (
                    <div className="font-medium text-slate-900">{contact.accountCity ?? "—"}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-slate-600">Customer type</div>
                  {editing ? (
                    <select value={customerProfileId} onChange={(e) => setCustomerProfileId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1 text-sm">
                      <option value="">Unspecified</option>
                      {customerProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : (
                    <div className="font-medium text-slate-900">{customerProfiles.find((p) => p.id === contact.accountCustomerProfileId)?.name ?? "—"}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-slate-600">Business type</div>
                  {editing ? (
                    <>
                      <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1 text-sm">
                        <option value="">Unspecified</option>
                        <option value="B2B">B2B</option>
                        <option value="B2C">B2C</option>
                        <option value="B2G">B2G</option>
                        <option value="Other">Other</option>
                      </select>
                      {isBusinessTypeOther && (
                        <input value={businessTypeOther} onChange={(e) => setBusinessTypeOther(e.target.value)} placeholder="Describe the business type" className="mt-1.5 w-full border border-slate-300 rounded-lg px-2 py-1 text-sm" />
                      )}
                    </>
                  ) : (
                    <div className="font-medium text-slate-900">{contact.accountBusinessType ?? "—"}</div>
                  )}
                </div>
                <div><div className="text-xs text-slate-600">Contact created</div><div className="font-medium text-slate-900">{fmtDate(contact.createdAt)}</div></div>
              </div>

              <div className="mt-4">
                <div className="text-xs text-slate-600">What this lead wants</div>
                {editing ? (
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
                ) : contact.notes ? (
                  <div className="text-base text-slate-700 whitespace-pre-wrap">{contact.notes}</div>
                ) : (
                  <div className="text-slate-400">—</div>
                )}
              </div>

              {editing && (
                <label className="flex items-center gap-2 text-sm text-slate-700 mt-4">
                  <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
                  Primary contact for this company
                </label>
              )}

              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="text-xs text-slate-600 mb-2">Custom fields</div>
                {editing ? (
                  <div className="space-y-2">
                    {Object.keys(fields).map((k) => (
                      <div key={k} className="flex gap-2 items-center">
                        <span className="text-xs text-slate-600 w-28 shrink-0 truncate" title={k}>{k}</span>
                        <input
                          value={fields[k] ?? ""}
                          onChange={(e) => setFields((prev) => ({ ...prev, [k]: e.target.value }))}
                          className="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-sm"
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
                        className="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-sm"
                      />
                      <button type="button" onClick={addField} className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg font-medium text-slate-700 shrink-0">
                        + Field
                      </button>
                    </div>
                  </div>
                ) : Object.keys(contact.fields).length > 0 ? (
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.entries(contact.fields).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs text-slate-600 truncate" title={k}>{k}</dt>
                        <dd className="font-medium text-slate-900">{v || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <div className="text-slate-400 text-sm">No custom fields yet.</div>
                )}
              </div>
            </div>

            <div id="deals" className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-slate-900">Deals <span className="text-slate-400 font-normal">{deals.length}</span></h3>
                <button
                  onClick={() => setPendingAction("deal")}
                  aria-label="New deal"
                  title="New deal"
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none"
                >
                  +
                </button>
              </div>
              {deals.length === 0 ? (
                <p className="text-sm text-slate-400">No deals where this person is the primary contact yet.</p>
              ) : (
                <div className="space-y-2">
                  {deals.map((d) => (
                    <div key={d.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                      <Link href={`/deals/${d.id}`} className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 hover:underline truncate">{d.title}</div>
                        <div className="text-xs text-slate-600">{d.code}</div>
                      </Link>
                      <div className="text-right shrink-0 ml-3">
                        <select
                          value={d.stageId}
                          onChange={(e) => onStagePick(d, e.target.value)}
                          className="text-[11px] font-medium border-0 rounded-full px-2 py-0.5 mb-0.5"
                          style={{ background: (d.stageColorHex ?? "#64748b") + "20", color: d.stageColorHex ?? "#475569" }}
                        >
                          {funnelStages.map((s) => (
                            // Without its own color, an <option> inherits the
                            // <select>'s inline color — every row in the open
                            // list rendered in the CURRENT stage's color
                            // (see the screenshot this fixed) instead of its
                            // own stage's.
                            <option key={s.id} value={s.id} style={{ color: s.colorHex ?? "#475569" }}>{s.name}</option>
                          ))}
                        </select>
                        <div className="text-xs text-slate-600">{fmtInr(d.wonValue ?? d.quotedValue)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div id="quotations" className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-slate-900">Quotations <span className="text-slate-400 font-normal">{quotations.length}</span></h3>
                <button
                  onClick={() => onQuickAction("quote")}
                  aria-label="New quotation"
                  title="New quotation"
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none"
                >
                  +
                </button>
              </div>
              {quotations.length === 0 ? (
                <p className="text-sm text-slate-400">No quotations created for this person yet.</p>
              ) : (
                <div className="space-y-2">
                  {quotations.map((q) => (
                    <div key={q.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 font-mono">{q.number}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${STATUS_COLORS[q.status] ?? "bg-slate-100 text-slate-700"}`}>
                            {q.status}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600">{fmtInr(q.grandTotal)} · {fmtDate(q.sentAt ?? q.createdAt)}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <a href={`/api/quotations/${q.id}/pdf`} target="_blank" rel="noreferrer" className="text-xs text-wa-dark hover:underline">
                          View PDF
                        </a>
                        <button onClick={() => resendQuotation(q)} disabled={resending === q.id} className="text-xs text-blue-700 hover:underline disabled:opacity-40">
                          {resending === q.id ? "…" : q.status === "draft" ? "Send" : "Resend"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div id="court-designs" className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-slate-900">Court Designs <span className="text-slate-400 font-normal">{courtImages.length}</span></h3>
                <button
                  onClick={() => onQuickAction("court")}
                  aria-label="New court design"
                  title="New court design"
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none"
                >
                  +
                </button>
              </div>
              {courtImages.length === 0 ? (
                <p className="text-sm text-slate-400">No court designs created for this person yet.</p>
              ) : (
                <div className="space-y-2">
                  {courtImages.map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 font-mono">{c.number}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${STATUS_COLORS[c.status] ?? "bg-slate-100 text-slate-700"}`}>
                            {c.status}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600">{fmtDate(c.sentAt ?? c.createdAt)}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        {c.imageUrl && (
                          <a href={c.imageUrl} target="_blank" rel="noreferrer" className="text-xs text-wa-dark hover:underline">
                            View design
                          </a>
                        )}
                        <button onClick={() => resendCourtImage(c)} disabled={resending === c.id} className="text-xs text-blue-700 hover:underline disabled:opacity-40">
                          {resending === c.id ? "…" : c.status === "draft" ? "Send" : "Resend"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div id="products" className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-slate-900">Product interest <span className="text-slate-400 font-normal">{productInterests.length}</span></h3>
                <button
                  onClick={() => onQuickAction("product")}
                  aria-label="Add product interest"
                  title="Add product interest"
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none"
                >
                  +
                </button>
              </div>
              {productInterests.length === 0 ? (
                <p className="text-sm text-slate-400">No products marked as interesting yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {productInterests.map((p) => (
                    <span key={p.id} className="text-xs px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full">
                      {p.name}{p.sportName ? ` · ${p.sportName}` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Meetings/Calls — each merges scheduled (Reminder) + logged
                (Activity) entries of that type, same as the Quotations/
                Court Designs sections mix draft+sent in one list. Scheduled
                ones already surface in My Day (Due today/Overdue) with zero
                extra wiring since they're ordinary owner-scoped Reminders;
                this is what gives a rep visibility + the mark-complete-
                with-a-note action right on the contact, matching the Zoho
                reference. */}
            {renderTypedSection("meetings", "Meetings", meetingRows, () => onQuickAction("meeting"))}
            {renderTypedSection("calls", "Calls", callRows, () => onQuickAction("call"))}

            {/* General running note log — deliberately separate from
                Activities below (structured: type/subject/duration/outcome).
                A plain scratchpad, like Zoho's own Notes tab; excluded from
                analytics on purpose (see AccountContactNote's own schema
                comment). */}
            <div id="notes" className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-slate-900">Notes <span className="text-slate-400 font-normal">{contactNotes.length}</span></h3>
                <button
                  onClick={() => setShowAddNote((v) => !v)}
                  aria-label="Add note"
                  title="Add note"
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none"
                >
                  +
                </button>
              </div>
              {showAddNote && (
                <div className="border border-slate-200 rounded-lg p-3 mb-3">
                  <input
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="Title (optional)"
                    className="w-full border-0 border-b border-slate-200 px-0 py-1.5 text-sm font-medium focus:outline-none focus:border-wa-green mb-2"
                  />
                  <textarea
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder="What's this note about?"
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  />
                  <div className="flex gap-2 justify-end mt-2">
                    <button onClick={() => { setShowAddNote(false); setNoteTitle(""); setNoteBody(""); }} className="text-sm font-medium text-slate-700 px-3 py-1.5">
                      Cancel
                    </button>
                    <button onClick={submitNote} disabled={savingNote || !noteBody.trim()} className="bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50">
                      {savingNote ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              )}
              {contactNotes.length === 0 ? (
                <p className="text-sm text-slate-400">No notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {contactNotes.map((n) => (
                    <div key={n.id} className="border-l-2 border-slate-200 pl-3 py-0.5">
                      {n.title && <div className="text-sm font-semibold text-slate-900">{n.title}</div>}
                      <div className="text-sm text-slate-700 whitespace-pre-wrap">{n.body}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{fmtDateTime(n.createdAt)} · {n.authorName}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div id="attachments" className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-slate-900">Attachments <span className="text-slate-400 font-normal">{attachments.length}</span></h3>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  aria-label="Upload file"
                  title="Upload file"
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none disabled:opacity-50"
                >
                  +
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); }}
                />
              </div>
              {uploadingFile && <p className="text-sm text-slate-400 mb-2">Uploading...</p>}
              {attachments.length === 0 ? (
                <p className="text-sm text-slate-400">No files uploaded yet.</p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                      <a href={a.fileUrl} target="_blank" rel="noreferrer" className="min-w-0">
                        <div className="text-sm font-medium text-wa-dark hover:underline truncate">{a.fileName}</div>
                        <div className="text-xs text-slate-500">{fmtFileSize(a.fileSize)} · {fmtDateTime(a.createdAt)} · {a.uploadedByName}</div>
                      </a>
                      <button onClick={() => deleteAttachment(a.id)} aria-label={`Delete ${a.fileName}`} className="text-slate-400 hover:text-red-600 text-xs shrink-0 px-2">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div id="activities" className="bg-white rounded-xl border border-slate-200 p-4 scroll-mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-slate-900">Activities <span className="text-slate-400 font-normal">{activities.length}</span></h3>
                <button
                  onClick={() => setShowLogActivity(true)}
                  aria-label="Log activity"
                  title="Log activity"
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none"
                >
                  +
                </button>
              </div>
              {activities.length === 0 ? (
                <p className="text-sm text-slate-400">Nothing logged against this person specifically yet.</p>
              ) : (
                <div className="space-y-2">
                  {activities.map((a) => (
                    <div key={a.id} className="border-l-2 border-slate-200 pl-3 py-0.5">
                      <div className="text-sm text-slate-900"><span className="font-medium">{a.typeName}</span> — {a.subject}</div>
                      <div className="text-xs text-slate-600">
                        {fmtDate(a.occurredAt)} · {a.ownerName}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingAction && (
        <CreateDealFirstModal
          contactId={contact.id}
          accountId={contact.accountId}
          contactName={contact.name}
          onClose={() => setPendingAction(null)}
          onCreated={(dealId) => {
            const action = pendingAction;
            setPendingAction(null);
            if (action === "deal") {
              toast.success("Deal created");
              router.refresh();
            } else if (action === "meeting" || action === "call") {
              openSchedule(action, dealId);
            } else {
              goToWizard(action, dealId);
            }
          }}
        />
      )}

      {showLogActivity && (
        <LogActivityModal
          contactId={contact.id}
          deals={deals}
          activityTypes={activityTypes}
          onClose={() => setShowLogActivity(false)}
          onLogged={() => { setShowLogActivity(false); toast.success("Activity logged"); router.refresh(); }}
        />
      )}

      {scheduleMode && scheduleDealId && (
        <ScheduleReminderModal
          mode={scheduleMode}
          dealId={scheduleDealId}
          contactName={contact.name}
          activityTypes={activityTypes}
          onClose={() => { setScheduleMode(null); setScheduleDealId(null); }}
          onScheduled={() => {
            setScheduleMode(null);
            setScheduleDealId(null);
            toast.success(scheduleMode === "meeting" ? "Meeting scheduled" : "Call scheduled");
            router.refresh();
          }}
        />
      )}

      {closeoutFor && (
        <CloseoutModal
          deal={closeoutFor.deal}
          stage={closeoutFor.stage}
          lossReasons={lossReasons}
          onClose={() => setCloseoutFor(null)}
          onConfirm={(extra) => {
            changeStage(closeoutFor.deal, closeoutFor.stage, extra);
            setCloseoutFor(null);
          }}
        />
      )}

      {showProductPicker && (
        <ProductInterestModal
          contactId={contact.id}
          accountId={contact.accountId}
          contactName={contact.name}
          existingDealId={deals[0]?.id ?? null}
          products={products}
          onClose={() => setShowProductPicker(false)}
          onSaved={() => { setShowProductPicker(false); toast.success("Product interest recorded"); router.refresh(); }}
        />
      )}
    </div>
  );
}

// "Schedule Meeting"/"Schedule Call" quick actions — both just create a
// Reminder (already the thing that surfaces in My Day's Due today/Overdue
// with zero extra wiring), tagged with the matching real ActivityType
// (Google Meet / In-Person Meeting / Outbound Call) so it reads correctly
// everywhere those are already shown. "Log a call" (something that
// already happened) is deliberately NOT here — that's the existing Log
// Activity flow, which already supports picking Inbound/Outbound Call.
function ScheduleReminderModal({
  mode, dealId, contactName, activityTypes, onClose, onScheduled,
}: {
  mode: "meeting" | "call"; dealId: string; contactName: string; activityTypes: ActivityTypeOption[];
  onClose: () => void; onScheduled: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(mode === "meeting" ? `Meeting with ${contactName}` : `Call with ${contactName}`);
  const [venueType, setVenueType] = useState<"online" | "physical">("online");
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1); // sensible default: tomorrow
    return d.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState("10:00");
  const [saving, setSaving] = useState(false);

  function findType(name: string) {
    return activityTypes.find((t) => t.name === name)?.id;
  }

  async function submit() {
    if (!title.trim() || !date || !time) return;
    setSaving(true);
    const dueAt = new Date(`${date}T${time}:00`);
    const activityTypeId =
      mode === "call" ? findType("Outbound Call") : venueType === "online" ? findType("Google Meet") : findType("In-Person Meeting");
    const res = await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealId,
        message: title.trim(),
        dueAt: dueAt.toISOString(),
        activityTypeId: activityTypeId ?? undefined,
        location: mode === "meeting" && venueType === "physical" ? location.trim() || undefined : undefined,
        meetingUrl: mode === "meeting" && venueType === "online" ? meetingUrl.trim() || undefined : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) onScheduled();
    else toast.error("Could not schedule");
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-5">
        <h2 className="font-semibold text-slate-900 mb-3">{mode === "meeting" ? "Schedule meeting" : "Schedule call"}</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {mode === "meeting" && (
            <div>
              <label className="text-xs font-medium text-slate-600">Venue</label>
              <div className="flex gap-2 mt-1 mb-2">
                <button type="button" onClick={() => setVenueType("online")} className={`text-xs px-2.5 py-1 rounded-lg border ${venueType === "online" ? "bg-wa-green/10 border-wa-green text-wa-dark font-medium" : "border-slate-200 text-slate-500"}`}>
                  Online
                </button>
                <button type="button" onClick={() => setVenueType("physical")} className={`text-xs px-2.5 py-1 rounded-lg border ${venueType === "physical" ? "bg-wa-green/10 border-wa-green text-wa-dark font-medium" : "border-slate-200 text-slate-500"}`}>
                  Physical
                </button>
              </div>
              {venueType === "online" ? (
                <input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="Meeting link (optional)" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              ) : (
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Time</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700">Cancel</button>
          <button onClick={submit} disabled={saving || !title.trim()} className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">
            {saving ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Doubles as the standalone "+ New Deal" quick action and the "attach a
// quote/design but this contact has no deal yet" prompt — same minimal
// one-field creation either way, just different copy/next-step handling
// in the caller's onCreated.
function CreateDealFirstModal({
  contactId, accountId, contactName, onClose, onCreated,
}: { contactId: string; accountId: string; contactName: string; onClose: () => void; onCreated: (dealId: string) => void }) {
  const toast = useToast();
  const [creating, setCreating] = useState(false);

  async function create() {
    setCreating(true);
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `Deal for ${contactName}`, accountId, primaryContactId: contactId }),
    }).catch(() => null);
    setCreating(false);
    if (res?.ok) {
      const data = await res.json();
      onCreated(data.deal.id);
    } else {
      toast.error("Could not create a deal — set one up from the Deals tab instead");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-5">
        <h2 className="font-semibold text-slate-900 mb-2">New deal</h2>
        <p className="text-base text-slate-600 mb-4">Create a deal for {contactName} to track this opportunity.</p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700">Cancel</button>
          <button onClick={create} disabled={creating} className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">
            {creating ? "Creating..." : "Create deal"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogActivityModal({
  contactId, deals, activityTypes, onClose, onLogged,
}: { contactId: string; deals: Deal[]; activityTypes: ActivityTypeOption[]; onClose: () => void; onLogged: () => void }) {
  const toast = useToast();
  const [dealId, setDealId] = useState(deals[0]?.id ?? "");
  const [activityTypeId, setActivityTypeId] = useState(activityTypes[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [durationMins, setDurationMins] = useState("");
  const [outcome, setOutcome] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/crm/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountContactId: contactId,
        dealId: dealId || undefined,
        activityTypeId,
        subject,
        notes: notes || undefined,
        durationMins: durationMins ? Number(durationMins) : undefined,
        outcome: outcome || undefined,
      }),
    });
    setSaving(false);
    if (res.ok) onLogged();
    else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to log activity");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold text-slate-900 mb-4">Log activity</h2>
        <form onSubmit={submit} className="space-y-3">
          {deals.length > 0 && (
            <div>
              <label className="text-xs font-medium text-slate-600">Deal (optional)</label>
              <select value={dealId} onChange={(e) => setDealId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Not tied to a specific deal</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-slate-600">Type</label>
            <select value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              {activityTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} required autoFocus className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Duration (minutes)</label>
              <input type="number" min={0} max={1440} value={durationMins} onChange={(e) => setDurationMins(e.target.value)} placeholder="Optional" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Outcome</label>
              <input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Interested" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700">Cancel</button>
            <button type="submit" disabled={saving || !subject || !activityTypeId} className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">
              {saving ? "Saving..." : "Log activity"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CloseoutModal({
  deal, stage, lossReasons, onClose, onConfirm,
}: {
  deal: Deal; stage: StageOption; lossReasons: LossReasonOption[]; onClose: () => void;
  onConfirm: (extra: { wonValue?: number; lossReasonId?: string; lossReasonNote?: string }) => void;
}) {
  const [wonValue, setWonValue] = useState(deal.estimatedValue?.toString() ?? "");
  const [lossReasonId, setLossReasonId] = useState("");
  const [lossReasonNote, setLossReasonNote] = useState("");

  const needsValue = stage.stageType === "won";
  const needsReason = stage.requiresLossReason;
  const canConfirm = (!needsValue || !!wonValue) && (!needsReason || !!lossReasonId || !!lossReasonNote.trim());

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-5">
        <h2 className="font-semibold text-slate-900 mb-4">Move {deal.code} to &quot;{stage.name}&quot;</h2>
        <div className="space-y-3">
          {needsValue && (
            <div>
              <label className="text-xs font-medium text-slate-600">Won value (₹) *</label>
              <input type="number" min={0} value={wonValue} onChange={(e) => setWonValue(e.target.value)} autoFocus className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          {needsReason && (
            <>
              <div>
                <label className="text-xs font-medium text-slate-600">Reason {!lossReasonNote.trim() && "*"}</label>
                <select value={lossReasonId} onChange={(e) => setLossReasonId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" autoFocus>
                  <option value="">—</option>
                  {lossReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Notes {!lossReasonId && "*"}</label>
                <textarea value={lossReasonNote} onChange={(e) => setLossReasonNote(e.target.value)} rows={2} placeholder="Optional detail beyond the reason picked above" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700">Cancel</button>
          <button
            onClick={() =>
              onConfirm({
                wonValue: needsValue ? Number(wonValue) : undefined,
                lossReasonId: needsReason && lossReasonId ? lossReasonId : undefined,
                lossReasonNote: needsReason && lossReasonNote.trim() ? lossReasonNote.trim() : undefined,
              })
            }
            disabled={!canConfirm}
            className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductInterestModal({
  contactId, accountId, contactName, existingDealId, products, onClose, onSaved,
}: { contactId: string; accountId: string; contactName: string; existingDealId: string | null; products: ProductOption[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const [otherChecked, setOtherChecked] = useState(false);
  const [otherLabel, setOtherLabel] = useState("");
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  const canSubmit = picked.length > 0 || (otherChecked && otherLabel.trim().length > 0);

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    let dealId = existingDealId;
    if (!dealId) {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Deal for ${contactName}`, accountId, primaryContactId: contactId }),
      }).catch(() => null);
      if (res?.ok) dealId = (await res.json()).deal.id;
    }
    if (!dealId) {
      setSaving(false);
      toast.error("Could not create a deal to attach this to");
      return;
    }
    const res = await fetch(`/api/deals/${dealId}/interested-products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productIds: picked,
        otherLabel: otherChecked && otherLabel.trim() ? otherLabel.trim() : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else toast.error("Could not save product interest");
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-5">
        <h2 className="font-semibold text-slate-900 mb-1">Product interest</h2>
        <p className="text-sm text-slate-600 mb-3">What is {contactName} interested in?</p>
        <div className="border border-slate-300 rounded-lg max-h-64 overflow-y-auto divide-y divide-slate-100 mb-4">
          {products.map((p) => (
            <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} className="rounded border-slate-300" />
              <span className="text-slate-700">{p.name}</span>
              <span className="text-xs text-slate-400 ml-auto">{p.type}</span>
            </label>
          ))}
          {products.length === 0 && <p className="px-3 py-4 text-sm text-slate-400">No products in the catalogue.</p>}
          <label className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
            <input type="checkbox" checked={otherChecked} onChange={(e) => setOtherChecked(e.target.checked)} className="rounded border-slate-300" />
            <span className="text-slate-700">Other — not in the catalogue</span>
          </label>
        </div>
        {otherChecked && (
          <input
            value={otherLabel}
            onChange={(e) => setOtherLabel(e.target.value)}
            placeholder="Describe the product"
            autoFocus
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4"
          />
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700">Cancel</button>
          <button onClick={submit} disabled={saving || !canSubmit} className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
