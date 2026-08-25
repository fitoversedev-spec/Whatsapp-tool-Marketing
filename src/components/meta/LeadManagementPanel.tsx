"use client";

import { useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import type { Rep } from "./MoveToCrmDialog";
import type { MetaLeadDetail, MetaLeadLabelChip, MetaLeadNoteRow } from "@/lib/meta-ads/queries";
import {
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  LEAD_STAGE_CHIP,
  stageLabel,
  LABEL_COLORS,
  labelChip,
  labelDot,
} from "@/lib/meta-ads/lead-fields";

// The Meta-Leads-Centre-style "Lead management" sidebar on the lead detail page:
// Stage, Assigned-to, Reminder, Labels, and a running Notes log. Each control
// saves on its own (optimistic local state -> PATCH/POST; revert + toast on
// failure), so there is no page-level Save button. The left-hand fields table is
// untouched server data; this panel owns all the editable state locally.

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200";
const sectionLabelCls = "text-xs font-heading font-bold uppercase tracking-wide text-slate-500";

// UTC ISO -> "YYYY-MM-DDTHH:mm" in the viewer's local time (datetime-local value).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
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
}: {
  lead: MetaLeadDetail;
  reps: Rep[];
  labelCatalog: MetaLeadLabelChip[];
  currentUserId: string;
  isAdmin: boolean;
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

  const appliedIds = useMemo(() => new Set(applied.map((l) => l.id)), [applied]);
  const available = useMemo(() => catalog.filter((l) => !appliedIds.has(l.id)), [catalog, appliedIds]);

  // Always resolves to a boolean — a network-layer rejection (offline, reset,
  // aborted) becomes `false` so each caller's `if (!ok)` branch re-enables the
  // control, reverts the optimistic value, and toasts, instead of leaving the
  // saving flag stuck true forever.
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

  async function setReminder(next: string | null) {
    const prev = reminderIso;
    setReminderIso(next);
    setSavingReminder(true);
    const ok = await patch({ reminderAt: next });
    setSavingReminder(false);
    if (!ok) {
      setReminderIso(prev);
      toast.error("Could not update the reminder");
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

  const reminderOverdue = reminderIso ? new Date(reminderIso).getTime() < Date.now() : false;

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
          {/* The current owner may be a since-deactivated/soft-deleted rep who
              is no longer in the assignable list; keep them visible + selected
              (as "inactive") so the assignment isn't silently shown as
              Unassigned or lost when the rep edits something else. */}
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
              checked={!reminderIso}
              disabled={savingReminder}
              onChange={() => setReminder(null)}
            />
            No reminder
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="lead-reminder"
              checked={!!reminderIso}
              disabled={savingReminder}
              onChange={() => {
                // Default a fresh reminder to one day out at 9am local.
                const d = new Date();
                d.setDate(d.getDate() + 1);
                d.setHours(9, 0, 0, 0);
                setReminder(d.toISOString());
              }}
            />
            Schedule a reminder
          </label>
          {reminderIso && (
            <div className="pt-1 space-y-1">
              <input
                type="datetime-local"
                className={inputCls}
                value={toLocalInput(reminderIso)}
                disabled={savingReminder}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const d = new Date(v); // browser parses as local time
                  if (!Number.isNaN(d.getTime())) setReminder(d.toISOString());
                }}
              />
              <p className={`text-xs ${reminderOverdue ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                {reminderOverdue ? "Overdue — " : "Reminds on "}
                {fmtDateTime(reminderIso)}
              </p>
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
          <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50/60 p-2 space-y-2">
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
            <div className="flex items-center gap-1.5">
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
    </aside>
  );
}
