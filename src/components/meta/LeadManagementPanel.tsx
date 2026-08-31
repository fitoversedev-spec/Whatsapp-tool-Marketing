"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import type { Rep } from "./MoveToCrmDialog";
import type { MetaLeadDetail, MetaLeadLabelChip, MetaLeadNoteRow } from "@/lib/meta-ads/queries";
import { parseFieldData } from "@/lib/meta-ads/field-data";
import {
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  LEAD_STAGE_CHIP,
  stageLabel,
  LABEL_COLORS,
  labelChip,
  labelDot,
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

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

function toDatePart(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimePart(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
  currentUserId,
  isAdmin,
  onStageUpdated,
  onLabelsUpdated,
  showFormAnswers = true,
}: {
  lead: MetaLeadDetail;
  reps: Rep[];
  labelCatalog: MetaLeadLabelChip[];
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

  // --- Assigned-to -------------------------------------------------------
  const [assignedToUserId, setAssignedToUserId] = useState<string | null>(lead.assignedToUserId);
  const [savingAssignee, setSavingAssignee] = useState(false);

  // --- Reminder ----------------------------------------------------------
  const [reminderIso, setReminderIso] = useState<string | null>(lead.reminderAt);
  const [savingReminder, setSavingReminder] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<boolean>(!!lead.reminderAt);
  const [reminderDraft, setReminderDraft] = useState<string>(
    lead.reminderAt ? toLocalInput(lead.reminderAt) : "",
  );

  // Custom date/time popup state
  const [pickerPopupOpen, setPickerPopupOpen] = useState(false);
  const [datePart, setDatePart] = useState<string>(
    lead.reminderAt ? toDatePart(lead.reminderAt) : "",
  );
  const [timePart, setTimePart] = useState<string>(
    lead.reminderAt ? toTimePart(lead.reminderAt) : "",
  );
  const popupRef = useRef<HTMLDivElement>(null);

  // Close popup on outside click
  useEffect(() => {
    if (!pickerPopupOpen) return;
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPickerPopupOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pickerPopupOpen]);

  // --- Labels ------------------------------------------------------------
  const [catalog, setCatalog] = useState<MetaLeadLabelChip[]>(labelCatalog);
  const [applied, setApplied] = useState<MetaLeadLabelChip[]>(lead.labels);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState<string>("blue");
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [savingLabels, setSavingLabels] = useState(false);

  // --- Notes -------------------------------------------------------------
  const [notes, setNotes] = useState<MetaLeadNoteRow[]>(lead.notes);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

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
    setReminderIso(lead.reminderAt);
    setScheduleMode(!!lead.reminderAt);
    setReminderDraft(lead.reminderAt ? toLocalInput(lead.reminderAt) : "");
    setDatePart(lead.reminderAt ? toDatePart(lead.reminderAt) : "");
    setTimePart(lead.reminderAt ? toTimePart(lead.reminderAt) : "");
    setApplied(lead.labels);
    setNotes(lead.notes);
    setNoteDraft("");
    setPickerOpen(false);
    setPickerPopupOpen(false);
    setSalesForm(parseSalesData(lead.salesData));
    setNewCustomName("");
    setNewCustomValue("");
  }, [lead.id, lead.stage, lead.assignedToUserId, lead.reminderAt, lead.labels, lead.notes, lead.salesData]);

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

  async function setReminder(next: string | null): Promise<boolean> {
    const prev = reminderIso;
    setReminderIso(next);
    setSavingReminder(true);
    const ok = await patch({ reminderAt: next });
    setSavingReminder(false);
    if (!ok) {
      setReminderIso(prev);
      toast.error("Could not update the reminder");
    }
    return ok;
  }

  async function saveReminder() {
    const d = reminderDraft ? new Date(reminderDraft) : null;
    if (!d || Number.isNaN(d.getTime())) return;
    const ok = await setReminder(d.toISOString());
    if (ok) toast.success("Reminder set");
  }

  async function chooseNoReminder() {
    setScheduleMode(false);
    setPickerPopupOpen(false);
    if (reminderIso) {
      const ok = await setReminder(null);
      if (!ok) setScheduleMode(true);
    }
  }

  function chooseSchedule() {
    setScheduleMode(true);
    if (!datePart) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      const pad = (n: number) => String(n).padStart(2, "0");
      setDatePart(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      setTimePart("09:00");
      setReminderDraft(toLocalInput(d.toISOString()));
    }
  }

  function confirmDateTimePick() {
    if (datePart && timePart) {
      setReminderDraft(`${datePart}T${timePart}`);
    }
    setPickerPopupOpen(false);
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

  async function saveNote() {
    const body = noteDraft.trim();
    if (!body) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/ad-campaigns/leads/${lead.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.note) {
        toast.error("Could not save the note");
        return;
      }
      setNotes((n) => [data.note as MetaLeadNoteRow, ...n]);
      setNoteDraft("");
      noteRef.current?.focus();
    } catch {
      toast.error("Could not save the note");
    } finally {
      setSavingNote(false);
    }
  }

  async function deleteNote(id: string) {
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

  const reminderDraftDate = reminderDraft ? new Date(reminderDraft) : null;
  const reminderDraftValid = !!reminderDraftDate && !Number.isNaN(reminderDraftDate.getTime());
  const savedReminderMs = reminderIso ? new Date(reminderIso).getTime() : null;
  const draftReminderMs = reminderDraftValid ? reminderDraftDate!.getTime() : null;
  const reminderUnsaved = reminderDraftValid && draftReminderMs !== savedReminderMs;
  const canSetReminder = reminderDraftValid && reminderUnsaved && !savingReminder;
  const savedReminderOverdue = savedReminderMs !== null ? savedReminderMs < Date.now() : false;

  return (
    <aside className="card p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-heading font-bold text-slate-900">Lead management</h2>
        <span className={`badge ${LEAD_STAGE_CHIP[stage as keyof typeof LEAD_STAGE_CHIP] ?? "bg-slate-100 text-slate-700"}`}>
          {stageLabel(stage)}
        </span>
      </div>

      {/* Stage */}
      <div className="space-y-1.5">
        <label htmlFor="lead-stage" className={sectionLabelCls}>
          Stage
        </label>
        <select
          id="lead-stage"
          className={inputCls}
          value={stage}
          disabled={savingStage}
          onChange={(e) => onStageChange(e.target.value)}
        >
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
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

      {/* Reminder */}
      <div className="space-y-1.5">
        <span className={sectionLabelCls}>Reminder</span>
        <div className="space-y-1.5 pt-0.5">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="lead-reminder"
              checked={!scheduleMode}
              disabled={savingReminder}
              onChange={() => void chooseNoReminder()}
            />
            No reminder
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="lead-reminder"
              checked={scheduleMode}
              disabled={savingReminder}
              onChange={chooseSchedule}
            />
            Schedule a reminder
          </label>
          {scheduleMode && (
            <div className="pt-1 space-y-1.5">
              {/* Custom date/time popup with Done button */}
              <div className="relative" ref={popupRef}>
                <button
                  type="button"
                  onClick={() => setPickerPopupOpen((o) => !o)}
                  className={`${inputCls} text-left flex items-center justify-between`}
                >
                  <span className={reminderDraftValid ? "text-slate-800" : "text-slate-400"}>
                    {reminderDraftValid ? fmtDateTime(reminderDraftDate!.toISOString()) : "Pick date & time"}
                  </span>
                  <svg className="h-4 w-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                {pickerPopupOpen && (
                  <div className="absolute z-50 mt-1 left-0 right-0 rounded-lg border border-slate-200 bg-white shadow-lg p-3 space-y-3">
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">Date</label>
                        <input
                          type="date"
                          className={inputCls}
                          value={datePart}
                          onChange={(e) => setDatePart(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">Time</label>
                        <input
                          type="time"
                          className={inputCls}
                          value={timePart}
                          onChange={(e) => setTimePart(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {reminderIso && (
                        <button
                          type="button"
                          onClick={() => void chooseNoReminder()}
                          disabled={savingReminder}
                          className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={confirmDateTimePick}
                        disabled={!datePart || !timePart}
                        className="btn btn-primary flex-1 !py-1.5"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p
                  className={`text-xs ${
                    reminderUnsaved
                      ? "text-amber-600"
                      : savedReminderOverdue
                        ? "text-rose-600 font-semibold"
                        : "text-slate-500"
                  }`}
                >
                  {!reminderDraftValid
                    ? "Pick a date and time"
                    : reminderUnsaved
                      ? `Not saved — ${fmtDateTime(reminderDraftDate!.toISOString())}`
                      : `${savedReminderOverdue ? "Overdue — " : "Reminds on "}${fmtDateTime(reminderIso!)}`}
                </p>
                <button
                  type="button"
                  onClick={() => void saveReminder()}
                  disabled={!canSetReminder}
                  className="btn btn-primary !px-3 !py-1.5 shrink-0"
                >
                  {savingReminder ? "Setting…" : "Set reminder"}
                </button>
              </div>
            </div>
          )}
        </div>
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
            className={`${inputCls} resize-y`}
            onChange={(e) => setNoteDraft(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">{noteDraft.length}/4000</span>
            <button
              type="button"
              onClick={() => void saveNote()}
              disabled={savingNote || !noteDraft.trim()}
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
