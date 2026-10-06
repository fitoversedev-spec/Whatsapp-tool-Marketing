"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import type { Rep } from "./MoveToCrmDialog";
import type { MetaLeadDetail, MetaLeadLabelChip, MetaLeadNoteRow } from "@/lib/meta-ads/queries";
import { parseFieldData } from "@/lib/meta-ads/field-data";
import { forgetNote, rememberNote } from "@/lib/meta-ads/note-outbox";
import {
  LABEL_COLORS,
  labelChip,
  labelDot,
  stageChipFromRow,
  stageLabelFromRow,
  type MetaLeadStageRow,
} from "@/lib/meta-ads/lead-fields";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200";
const sectionLabelCls = "text-xs font-heading font-bold uppercase tracking-wide text-slate-500";

type SalesFormData = {
  sport: string;
  dimension: string;
  location: string;
  jobTitle: string;
  timeline: string;
  b2bB2c: string;
  custom: { name: string; value: string }[];
};

const EMPTY_SALES: SalesFormData = { sport: "", dimension: "", location: "", jobTitle: "", timeline: "", b2bB2c: "", custom: [] };

function parseSalesData(raw: string | null): SalesFormData {
  if (!raw) return { ...EMPTY_SALES, custom: [] };
  try {
    const d = JSON.parse(raw);
    return {
      sport: d.sport ?? "",
      dimension: d.dimension ?? "",
      location: d.location ?? "",
      jobTitle: d.jobTitle ?? "",
      timeline: d.timeline ?? "",
      b2bB2c: d.b2bB2c ?? "",
      custom: Array.isArray(d.custom) ? d.custom : [],
    };
  } catch { return { ...EMPTY_SALES, custom: [] }; }
}


// A note being written in the Notes box: the lead it belongs to, the box text,
// the note's id (picked here at its first save, so every save of it is the
// same repeatable request), and the text the server last stored.
type NoteDraft = {
  leadId: string;
  text: string;
  noteId: string | null;
  saved: string;
  row: MetaLeadNoteRow | null;
  retried: boolean;
};

function newDraft(leadId: string): NoteDraft {
  return { leadId, text: "", noteId: null, saved: "", row: null, retried: false };
}

function newNoteId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Older browsers: a version-4 UUID from random bytes.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Auto-save fires this long after the last keystroke.
const NOTE_AUTOSAVE_MS = 2000;

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function LeadManagementPanel({
  lead,
  reps,
  labelCatalog,
  stageCatalog = [],
  currentUserId,
  isAdmin,
  onStageUpdated,
  onLabelsUpdated,
  showFormAnswers = true,
}: {
  lead: MetaLeadDetail;
  reps: Rep[];
  labelCatalog: MetaLeadLabelChip[];
  stageCatalog?: MetaLeadStageRow[];
  currentUserId: string;
  isAdmin: boolean;
  onStageUpdated?: (leadId: string, newStage: string) => void;
  onLabelsUpdated?: (leadId: string, labels: MetaLeadLabelChip[]) => void;
  showFormAnswers?: boolean;
}) {
  const toast = useToast();

  // --- Stage -------------------------------------------------------------
  const [stage, setStage] = useState(lead.stage);
  const [savingStage, setSavingStage] = useState(false);
  const [stages, setStages] = useState<MetaLeadStageRow[]>(stageCatalog);
  const [addingStage, setAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [creatingStage, setCreatingStage] = useState(false);
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false);
  const stageDropdownRef = useRef<HTMLDivElement>(null);

  // --- Assigned-to -------------------------------------------------------
  const [assignedToUserId, setAssignedToUserId] = useState<string | null>(lead.assignedToUserId);
  const [savingAssignee, setSavingAssignee] = useState(false);

  // --- Reminders (multiple) -----------------------------------------------
  type ReminderRow = { id: string; message: string; dueAt: string; status: string; completedAt: string | null };
  const [reminders, setReminders] = useState<ReminderRow[]>(lead.reminders ?? []);
  const [savingReminder, setSavingReminder] = useState(false);
  const [addingReminder, setAddingReminder] = useState(false);
  const [datePart, setDatePart] = useState("");
  const [timePart, setTimePart] = useState("");
  const [reminderMsg, setReminderMsg] = useState("");
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addingReminder) return;
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setAddingReminder(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [addingReminder]);

  useEffect(() => {
    if (!stageDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (stageDropdownRef.current && !stageDropdownRef.current.contains(e.target as Node)) {
        setStageDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [stageDropdownOpen]);

  // --- Labels ------------------------------------------------------------
  const [catalog, setCatalog] = useState<MetaLeadLabelChip[]>(labelCatalog);
  const [applied, setApplied] = useState<MetaLeadLabelChip[]>(lead.labels);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState<string>("blue");
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [savingLabels, setSavingLabels] = useState(false);

  // --- Notes -------------------------------------------------------------
  // The box saves itself: 2s after typing stops (or when it loses focus) the
  // text is saved as a note, and further typing keeps updating that same note.
  // "Save note" — or opening another lead, closing the panel, leaving the page
  // — finishes it; the next words start a new note. Emptying the box removes
  // the half-written note.
  const [notes, setNotes] = useState<MetaLeadNoteRow[]>(lead.notes);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteStatus, setNoteStatus] = useState<"idle" | "saving" | "saved" | "retrying" | "error">("idle");
  const [savingNote, setSavingNote] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<NoteDraft>(newDraft(lead.id));
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const noteBusyRef = useRef(false);
  const shownLeadIdRef = useRef(lead.id);

  // --- Sales follow-up ----------------------------------------------------
  const [salesForm, setSalesForm] = useState<SalesFormData>(() => parseSalesData(lead.salesData));
  const [savingSales, setSavingSales] = useState(false);
  const [newCustomName, setNewCustomName] = useState("");
  const [newCustomValue, setNewCustomValue] = useState("");
  const salesEnabled = stage !== "NEW";

  // --- Form answers ------------------------------------------------------
  const formAnswers = useMemo(() => parseFieldData(lead.fieldData), [lead.fieldData]);

  const appliedIds = useMemo(() => new Set(applied.map((l) => l.id)), [applied]);
  const available = useMemo(() => catalog.filter((l) => !appliedIds.has(l.id)), [catalog, appliedIds]);

  // Reset local state when the lead changes (sidebar switches between leads)
  useEffect(() => {
    setStage(lead.stage);
    setAssignedToUserId(lead.assignedToUserId);
    setReminders(lead.reminders ?? []);
    setAddingReminder(false);
    setDatePart("");
    setTimePart("");
    setReminderMsg("");
    setApplied(lead.labels);
    setPickerOpen(false);
    setSalesForm(parseSalesData(lead.salesData));
    setNewCustomName("");
    setNewCustomValue("");
  }, [lead.id, lead.stage, lead.assignedToUserId, lead.reminders, lead.labels, lead.salesData]);

  // Notes follow the lead too, but a half-written note must not be lost when
  // the panel switches lead (it's saved to the previous lead first) or when the
  // same lead is re-fetched (it stays listed even if the fetch predates it).
  useEffect(() => {
    const d = draftRef.current;
    if (d.leadId !== lead.id) {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      void queueDraftSave(d);
      draftRef.current = newDraft(lead.id);
      setNoteDraft("");
      setNoteStatus("idle");
    }
    shownLeadIdRef.current = lead.id;
    const row = draftRef.current.row;
    setNotes(row && !lead.notes.some((n) => n.id === row.id) ? [row, ...lead.notes] : lead.notes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.notes]);

  // Closing the panel or leaving the page saves what's in the box. The save is
  // sent at once rather than queued — a queued one might never get its turn
  // on a page that's going away — which is safe because saving the same note
  // twice can't make two notes (see syncDraft).
  useEffect(() => {
    function flushOnLeave() {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      const d = draftRef.current;
      // With a save in flight, `saved` isn't confirmed yet — send regardless.
      if (noteBusyRef.current) void syncDraft(d, true);
      else if (d.text.trim() !== d.saved) void syncDraft(d);
    }
    window.addEventListener("pagehide", flushOnLeave);
    return () => {
      window.removeEventListener("pagehide", flushOnLeave);
      flushOnLeave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patch(payload: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/ad-campaigns/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function onStageChange(next: string) {
    const prev = stage;
    setStage(next);
    setSavingStage(true);
    const ok = await patch({ stage: next });
    setSavingStage(false);
    if (!ok) {
      setStage(prev);
      toast.error("Could not update the stage");
    } else {
      onStageUpdated?.(lead.id, next);
    }
  }

  async function onCreateStage() {
    const name = newStageName.trim();
    if (!name) return;
    setCreatingStage(true);
    try {
      const res = await fetch("/api/admin/taxonomy/meta-lead-stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const msg = res.status === 403 ? "Only admins can create stages" : "Could not create stage";
        toast.error(msg);
        return;
      }
      const { row } = await res.json();
      const newRow: MetaLeadStageRow = { id: row.id, slug: row.slug, name: row.name, colorHex: row.colorHex ?? null, isDefault: false };
      setStages((prev) => [...prev, newRow]);
      setNewStageName("");
      setAddingStage(false);
      onStageChange(row.slug);
    } catch {
      toast.error("Could not create stage");
    } finally {
      setCreatingStage(false);
    }
  }

  async function onDeleteStage(s: MetaLeadStageRow) {
    if (s.isDefault || !s.id) return;
    try {
      const res = await fetch(`/api/admin/taxonomy/meta-lead-stages/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleted: true }),
      });
      if (!res.ok) {
        const msg = res.status === 403 ? "Only admins can remove stages" : "Could not remove stage";
        toast.error(msg);
        return;
      }
      setStages((prev) => prev.filter((x) => x.slug !== s.slug));
      if (stage === s.slug) onStageChange("NEW");
    } catch {
      toast.error("Could not remove stage");
    }
  }

  async function onAssigneeChange(next: string) {
    const prev = assignedToUserId;
    const value = next || null;
    setAssignedToUserId(value);
    setSavingAssignee(true);
    const ok = await patch({ assignedToUserId: value });
    setSavingAssignee(false);
    if (!ok) {
      setAssignedToUserId(prev);
      toast.error("Could not update the assignee");
    }
  }

  async function addReminder() {
    if (!datePart || !timePart) return;
    const dueAt = new Date(`${datePart}T${timePart}`);
    if (Number.isNaN(dueAt.getTime())) return;
    const leadName = lead.fullName?.trim() || lead.phone || "lead";
    const message = reminderMsg.trim() || `Follow up with ${leadName}`;
    setSavingReminder(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaLeadId: lead.id, dueAt: dueAt.toISOString(), message }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.reminder) {
        setReminders((r) => [...r, { id: data.reminder.id, message, dueAt: dueAt.toISOString(), status: "PENDING", completedAt: null }]);
        setAddingReminder(false);
        setDatePart("");
        setTimePart("");
        setReminderMsg("");
        toast.success("Reminder added");
      } else {
        toast.error("Could not add reminder");
      }
    } catch {
      toast.error("Could not add reminder");
    } finally {
      setSavingReminder(false);
    }
  }

  async function deleteReminder(id: string) {
    const prev = reminders;
    setReminders((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setReminders(prev);
        toast.error("Could not delete reminder");
      }
    } catch {
      setReminders(prev);
      toast.error("Could not delete reminder");
    }
  }

  async function completeReminder(id: string) {
    const prev = reminders;
    setReminders((r) => r.map((x) => x.id === id ? { ...x, status: "DONE", completedAt: new Date().toISOString() } : x));
    try {
      const res = await fetch(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completedAt: new Date().toISOString() }),
      });
      if (!res.ok) {
        setReminders(prev);
        toast.error("Could not complete reminder");
      }
    } catch {
      setReminders(prev);
      toast.error("Could not complete reminder");
    }
  }

  function startAddReminder() {
    setAddingReminder(true);
    if (!datePart) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      const pad = (n: number) => String(n).padStart(2, "0");
      setDatePart(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      setTimePart("09:00");
    }
  }

  async function saveLabels(nextApplied: MetaLeadLabelChip[]) {
    const prev = applied;
    setApplied(nextApplied);
    setSavingLabels(true);
    const ok = await patch({ labelIds: nextApplied.map((l) => l.id) });
    setSavingLabels(false);
    if (!ok) {
      setApplied(prev);
      toast.error("Could not update labels");
    } else {
      onLabelsUpdated?.(lead.id, nextApplied);
    }
  }

  function addLabel(label: MetaLeadLabelChip) {
    if (appliedIds.has(label.id)) return;
    void saveLabels([...applied, label]);
  }
  function removeLabel(id: string) {
    void saveLabels(applied.filter((l) => l.id !== id));
  }

  async function createAndAddLabel() {
    const name = newLabelName.trim();
    if (!name) return;
    setCreatingLabel(true);
    try {
      const res = await fetch("/api/ad-campaigns/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: newLabelColor }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.label) {
        toast.error("Could not create the label");
        return;
      }
      const label: MetaLeadLabelChip = data.label;
      setCatalog((c) => (c.some((l) => l.id === label.id) ? c : [...c, label]));
      setNewLabelName("");
      addLabel(label);
    } catch {
      toast.error("Could not create the label");
    } finally {
      setCreatingLabel(false);
    }
  }

  // Bring the server in line with one draft: save its note (PUT to the id
  // picked here, which creates it the first time and updates it after), or
  // remove it when the box was emptied. Requests use keepalive so a save in
  // flight still lands if the page closes meanwhile. Never throws; false = not
  // saved. `force` sends even when the text matches the last confirmed save.
  async function syncDraft(d: NoteDraft, force = false): Promise<boolean> {
    const body = d.text.trim();
    if (!force && body === d.saved) return true;
    const base = `/api/ad-campaigns/leads/${d.leadId}/notes`;
    const shown = () => shownLeadIdRef.current === d.leadId;
    try {
      if (!body) {
        if (!d.noteId) return true;
        const gone = d.noteId;
        const res = await fetch(`${base}/${gone}`, { method: "DELETE", keepalive: true });
        if (!res.ok && res.status !== 404) return false;
        forgetNote(gone, "");
        if (d.noteId === gone) {
          d.noteId = null;
          d.saved = "";
          d.row = null;
        }
        if (shown()) setNotes((n) => n.filter((x) => x.id !== gone));
        return true;
      }
      if (!d.noteId) d.noteId = newNoteId();
      const id = d.noteId;
      const res = await fetch(`${base}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
        keepalive: true,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.note) return false;
      forgetNote(id, body);
      const row = data.note as MetaLeadNoteRow;
      if (d.noteId === id) {
        d.saved = body;
        d.row = row;
      }
      if (shown()) {
        setNotes((n) => (n.some((x) => x.id === id) ? n.map((x) => (x.id === id ? row : x)) : [row, ...n]));
      }
      return true;
    } catch {
      return false;
    }
  }

  // Saves of the box run one at a time, so an older save can't land after a
  // newer one. With nothing in flight the request starts immediately.
  function queueDraftSave(d: NoteDraft): Promise<boolean> {
    const run = async () => {
      noteBusyRef.current = true;
      try {
        return await syncDraft(d);
      } finally {
        noteBusyRef.current = false;
      }
    };
    const p = noteBusyRef.current ? noteQueueRef.current.then(run, run) : run();
    noteQueueRef.current = p.catch(() => undefined);
    return p;
  }

  async function saveDraftNow(): Promise<boolean> {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    const d = draftRef.current;
    // While a save is in flight `saved` is not final yet — queue anyway; the
    // queued run compares again once that save has landed.
    if (!noteBusyRef.current && d.text.trim() === d.saved) {
      if (d.noteId) forgetNote(d.noteId, d.saved);
      return true;
    }
    setNoteStatus("saving");
    const ok = await queueDraftSave(d);
    if (draftRef.current === d) {
      // One automatic retry for a failed save; typing again also retries.
      if (ok) {
        d.retried = false;
        // Typing during the save means the newest words are still to go.
        setNoteStatus(d.noteId && d.text.trim() === d.saved ? "saved" : "idle");
      } else if (!d.retried) {
        d.retried = true;
        setNoteStatus("retrying");
        draftTimerRef.current = setTimeout(() => void saveDraftNow(), 5000);
      } else {
        setNoteStatus("error");
      }
    }
    return ok;
  }

  function onNoteInput(value: string) {
    setNoteDraft(value);
    const d = draftRef.current;
    d.text = value;
    d.retried = false;
    // Keep a copy in the browser until the server has it (see note-outbox).
    if (!d.noteId && value.trim()) d.noteId = newNoteId();
    if (d.noteId) rememberNote({ userId: currentUserId, leadId: d.leadId, noteId: d.noteId, body: value.trim() });
    setNoteStatus("idle");
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      void saveDraftNow();
    }, NOTE_AUTOSAVE_MS);
  }

  // "Save note": save now, then clear the box so the next words are a new note.
  async function finishNote() {
    const d = draftRef.current;
    if (!d.text.trim()) return;
    setSavingNote(true);
    const ok = await saveDraftNow();
    setSavingNote(false);
    if (!ok) {
      toast.error("Could not save the note");
      return;
    }
    if (draftRef.current !== d) return;
    draftRef.current = newDraft(d.leadId);
    setNoteDraft("");
    setNoteStatus("idle");
    noteRef.current?.focus();
  }

  async function deleteNote(id: string) {
    const d = draftRef.current;
    if (d.noteId === id) {
      // Deleting the note that's still being written discards it: empty its
      // draft (the queued save then removes the note) and clear the box.
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      d.text = "";
      rememberNote({ userId: currentUserId, leadId: d.leadId, noteId: id, body: "" });
      draftRef.current = newDraft(d.leadId);
      setNoteDraft("");
      setNoteStatus("idle");
      const row = d.row;
      setNotes((n) => n.filter((x) => x.id !== id));
      const ok = await queueDraftSave(d);
      if (!ok) {
        if (row) setNotes((n) => [row, ...n]);
        toast.error("Could not delete the note");
      }
      return;
    }
    const prev = notes;
    setNotes((n) => n.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/ad-campaigns/leads/${lead.id}/notes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setNotes(prev);
        toast.error("Could not delete the note");
      }
    } catch {
      setNotes(prev);
      toast.error("Could not delete the note");
    }
  }

  async function persistSales(next: SalesFormData) {
    setSalesForm(next);
    setSavingSales(true);
    const ok = await patch({ salesData: JSON.stringify(next) });
    setSavingSales(false);
    if (!ok) toast.error("Could not save sales data");
  }

  function setSalesLocal(key: keyof Omit<SalesFormData, "custom">, value: string) {
    setSalesForm((prev) => ({ ...prev, [key]: value }));
  }

  function blurSalesField(key: keyof Omit<SalesFormData, "custom">) {
    void persistSales(salesForm);
  }

  function selectSalesField(key: keyof Omit<SalesFormData, "custom">, value: string) {
    const next = { ...salesForm, [key]: value };
    void persistSales(next);
  }

  function addCustomField() {
    const n = newCustomName.trim();
    const v = newCustomValue.trim();
    if (!n || !v) return;
    void persistSales({ ...salesForm, custom: [...salesForm.custom, { name: n, value: v }] });
    setNewCustomName("");
    setNewCustomValue("");
  }

  function removeCustomField(idx: number) {
    void persistSales({ ...salesForm, custom: salesForm.custom.filter((_, i) => i !== idx) });
  }

  const openReminders = reminders.filter((r) => !r.completedAt);
  const doneReminders = reminders.filter((r) => !!r.completedAt);

  return (
    <aside className="card p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-heading font-bold text-slate-900">Lead management</h2>
        <span className={`badge ${stageChipFromRow(stage, stages)}`}>
          {stageLabelFromRow(stage, stages)}
        </span>
      </div>

      {/* Stage */}
      <div className="space-y-1.5">
        <label className={sectionLabelCls}>Stage</label>
        {addingStage ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              type="text"
              placeholder="Stage name"
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onCreateStage(); if (e.key === "Escape") { setAddingStage(false); setNewStageName(""); } }}
              disabled={creatingStage}
              className={inputCls}
            />
            <button onClick={onCreateStage} disabled={creatingStage || !newStageName.trim()} className="text-xs font-semibold text-white bg-court-600 hover:bg-court-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg shrink-0">
              {creatingStage ? "…" : "Add"}
            </button>
            <button onClick={() => { setAddingStage(false); setNewStageName(""); }} disabled={creatingStage} className="text-xs text-slate-500 hover:text-slate-800 px-1.5 py-1.5 rounded-lg shrink-0">
              ✕
            </button>
          </div>
        ) : (
          <div className="relative" ref={stageDropdownRef}>
            <button
              type="button"
              disabled={savingStage}
              onClick={() => setStageDropdownOpen((o) => !o)}
              className={`${inputCls} text-left flex items-center justify-between`}
            >
              <span>{stageLabelFromRow(stage, stages)}</span>
              <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {stageDropdownOpen && (
              <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg py-1 max-h-64 overflow-y-auto">
                {stages.map((s) => (
                  <div
                    key={s.slug}
                    className={`flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50 ${s.slug === stage ? "bg-court-50 text-court-700 font-medium" : "text-slate-700"}`}
                  >
                    <span
                      className="flex-1 min-w-0 truncate"
                      onClick={() => { onStageChange(s.slug); setStageDropdownOpen(false); }}
                    >
                      {s.name}
                    </span>
                    {!s.isDefault && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDeleteStage(s); }}
                        className="ml-2 p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                        title="Remove stage"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                ))}
                <div
                  className="px-3 py-1.5 text-sm text-court-600 font-medium cursor-pointer hover:bg-slate-50 border-t border-slate-100 mt-1"
                  onClick={() => { setStageDropdownOpen(false); setAddingStage(true); }}
                >
                  + Add stage
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Assigned to */}
      <div className="space-y-1.5">
        <label htmlFor="lead-assignee" className={sectionLabelCls}>
          Assigned to
        </label>
        <select
          id="lead-assignee"
          className={inputCls}
          value={assignedToUserId ?? ""}
          disabled={savingAssignee}
          onChange={(e) => onAssigneeChange(e.target.value)}
        >
          <option value="">Unassigned</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          {assignedToUserId && !reps.some((r) => r.id === assignedToUserId) && (
            <option value={assignedToUserId}>
              {(lead.assignedToName ?? "Unknown user") + " (inactive)"}
            </option>
          )}
        </select>
      </div>

      {/* Reminders */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={sectionLabelCls}>Reminders</span>
          {!addingReminder && (
            <button type="button" onClick={startAddReminder} className="text-xs font-medium text-court-600 hover:text-court-700">
              + Add
            </button>
          )}
        </div>
        {openReminders.length === 0 && !addingReminder && (
          <p className="text-xs text-slate-400">No reminders set</p>
        )}
        {openReminders.map((r) => {
          const overdue = new Date(r.dueAt).getTime() < Date.now();
          return (
            <div key={r.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${overdue ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 truncate">{r.message}</p>
                <p className={`text-xs font-mono ${overdue ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                  {overdue ? "Overdue — " : ""}{fmtDateTime(r.dueAt)}
                </p>
              </div>
              <button type="button" onClick={() => void completeReminder(r.id)} title="Mark done" className="text-emerald-500 hover:text-emerald-700 shrink-0 mt-0.5">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button type="button" onClick={() => void deleteReminder(r.id)} title="Delete" className="text-slate-400 hover:text-rose-600 shrink-0 mt-0.5">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          );
        })}
        {doneReminders.length > 0 && (
          <details className="pt-1">
            <summary className="text-xs text-slate-400 cursor-pointer">Completed ({doneReminders.length})</summary>
            <div className="space-y-1 mt-1">
              {doneReminders.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 opacity-60">
                  <svg className="h-3.5 w-3.5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span className="text-xs text-slate-600 truncate flex-1">{r.message}</span>
                  <span className="text-xs text-slate-400 font-mono shrink-0">{fmtDateTime(r.dueAt)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
        {addingReminder && (
          <div ref={popupRef} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 shadow-sm">
            <input
              type="text"
              className={inputCls}
              placeholder="Message (optional)"
              value={reminderMsg}
              onChange={(e) => setReminderMsg(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Date</label>
                <input type="date" className={inputCls} value={datePart} onChange={(e) => setDatePart(e.target.value)} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Time</label>
                <input type="time" className={inputCls} value={timePart} onChange={(e) => setTimePart(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setAddingReminder(false)} className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={() => void addReminder()} disabled={!datePart || !timePart || savingReminder} className="btn btn-primary flex-1 !py-1.5">
                {savingReminder ? "Adding…" : "Add reminder"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Labels */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={sectionLabelCls}>Labels</span>
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-900"
          >
            {pickerOpen ? "Done" : "+ Add label"}
          </button>
        </div>

        {applied.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {applied.map((l) => (
              <span
                key={l.id}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${labelChip(l.color)}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${labelDot(l.color)}`} />
                {l.name}
                <button
                  type="button"
                  onClick={() => removeLabel(l.id)}
                  disabled={savingLabels || creatingLabel}
                  aria-label={`Remove ${l.name}`}
                  className="ml-0.5 text-current/70 hover:text-current"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          !pickerOpen && <p className="text-xs text-slate-400">No labels yet.</p>
        )}

        {pickerOpen && (
          <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
            {available.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {available.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => addLabel(l)}
                    disabled={savingLabels || creatingLabel}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium hover:opacity-80 ${labelChip(l.color)}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${labelDot(l.color)}`} />
                    {l.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  onClick={() => setNewLabelColor(c)}
                  className={`h-4 w-4 rounded-full ${labelDot(c)} ${
                    newLabelColor === c ? "ring-2 ring-offset-1 ring-slate-400" : ""
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newLabelName}
                maxLength={40}
                placeholder="Create a label…"
                className={inputCls}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void createAndAddLabel();
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void createAndAddLabel()}
                disabled={creatingLabel || !newLabelName.trim()}
                className="btn btn-secondary !px-2.5 !py-1.5 shrink-0"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <span className={sectionLabelCls}>Notes</span>
        <div className="space-y-1.5">
          <textarea
            ref={noteRef}
            value={noteDraft}
            maxLength={4000}
            rows={3}
            placeholder="Write a note…"
            aria-label="Note"
            data-guide="wa-lead-notes"
            className={`${inputCls} resize-y`}
            onChange={(e) => onNoteInput(e.target.value)}
            onBlur={() => void saveDraftNow()}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400" aria-live="polite">
              {noteDraft.length}/4000
              {noteStatus === "saving" && <span className="ml-2">Saving…</span>}
              {noteStatus === "saved" && <span className="ml-2 text-emerald-600 font-medium">Saved ✓</span>}
              {noteStatus === "retrying" && <span className="ml-2 text-amber-600 font-medium">Not saved — trying again…</span>}
              {noteStatus === "error" && <span className="ml-2 text-rose-600 font-medium">Not saved — press Save note</span>}
            </span>
            <button
              type="button"
              onClick={() => void finishNote()}
              disabled={savingNote || !noteDraft.trim()}
              data-guide="wa-lead-note-save"
              className="btn btn-primary !px-3 !py-1.5"
            >
              {savingNote ? "Saving…" : "Save note"}
            </button>
          </div>
        </div>

        {notes.length > 0 && (
          <ul className="space-y-2 pt-1">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{n.body}</p>
                  {(n.authorUserId === currentUserId || isAdmin) && (
                    <button
                      type="button"
                      onClick={() => void deleteNote(n.id)}
                      aria-label="Delete note"
                      className="shrink-0 text-slate-300 hover:text-rose-600"
                    >
                      ×
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {n.authorName} • {fmtDateTime(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sales follow-up — enabled once stage moves past NEW */}
      {salesEnabled && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={sectionLabelCls}>Sales follow-up</span>
            {savingSales && <span className="text-[11px] text-slate-400">Saving…</span>}
          </div>
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Sport requested</label>
              <input className={inputCls} value={salesForm.sport} placeholder="e.g. Football, Cricket" onChange={(e) => setSalesLocal("sport", e.target.value)} onBlur={() => blurSalesField("sport")} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Dimension</label>
              <input className={inputCls} value={salesForm.dimension} placeholder="e.g. 100×60 ft" onChange={(e) => setSalesLocal("dimension", e.target.value)} onBlur={() => blurSalesField("dimension")} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Site location</label>
              <input className={inputCls} value={salesForm.location} placeholder="e.g. Chennai, TN" onChange={(e) => setSalesLocal("location", e.target.value)} onBlur={() => blurSalesField("location")} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Job title</label>
              <input className={inputCls} value={salesForm.jobTitle} placeholder="e.g. Builder, Architect" onChange={(e) => setSalesLocal("jobTitle", e.target.value)} onBlur={() => blurSalesField("jobTitle")} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">When they start the build</label>
              <input className={inputCls} value={salesForm.timeline} placeholder="e.g. 3 months, Q1 2027" onChange={(e) => setSalesLocal("timeline", e.target.value)} onBlur={() => blurSalesField("timeline")} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">B2B / B2C</label>
              <select className={inputCls} value={salesForm.b2bB2c} onChange={(e) => selectSalesField("b2bB2c", e.target.value)}>
                <option value="">— Not set —</option>
                <option value="B2B">B2B</option>
                <option value="B2C">B2C</option>
              </select>
            </div>
          </div>

          {/* Custom fields */}
          {salesForm.custom.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-medium text-slate-500">Custom fields</span>
              {salesForm.custom.map((cf, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <span className="text-xs font-medium text-slate-600 truncate">{cf.name}:</span>
                  <span className="text-xs text-slate-800 truncate flex-1">{cf.value}</span>
                  <button type="button" onClick={() => removeCustomField(i)} className="shrink-0 text-slate-300 hover:text-rose-600 text-sm">×</button>
                </div>
              ))}
            </div>
          )}
          <div className="pt-1 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <input className={inputCls} value={newCustomName} placeholder="Field name" maxLength={60} onChange={(e) => setNewCustomName(e.target.value)} />
              <input className={inputCls} value={newCustomValue} placeholder="Value" maxLength={200} onChange={(e) => setNewCustomValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomField(); } }} />
              <button type="button" onClick={addCustomField} disabled={!newCustomName.trim() || !newCustomValue.trim() || savingSales} className="btn btn-secondary !px-2.5 !py-1.5 shrink-0">+</button>
            </div>
          </div>
        </div>
      )}

      {/* Form answers — stacked Q&A like Meta Leads Centre */}
      {showFormAnswers && formAnswers.length > 0 && (
        <div className="space-y-1.5">
          <span className={sectionLabelCls}>Form answers</span>
          <div className="space-y-3">
            {formAnswers.map((f, i) => (
              <div key={i}>
                <div className="text-xs text-court-600 capitalize">
                  {f.name.replace(/_/g, " ")}
                </div>
                <div className="text-sm font-semibold text-slate-900 mt-0.5">
                  {f.value || "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
