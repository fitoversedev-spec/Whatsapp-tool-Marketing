"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import type { Rep } from "@/components/meta/MoveToCrmDialog";
import type { MetaLeadLabelChip } from "@/lib/meta-ads/queries";
import {
  LABEL_COLORS,
  labelChip,
  labelDot,
  stageChipFromRow,
  stageLabelFromRow,
  type MetaLeadStageRow,
} from "@/lib/meta-ads/lead-fields";
import { fmtDateTimeIST } from "@/lib/time";
import type { WebsiteLeadDetail, WebsiteLeadNoteRow } from "@/lib/website-leads/list";

// The "Lead management" card for one website lead: stage, assigned rep, labels
// and notes. The detail page and the list's side panel both render it, so they
// behave the same. It starts from the lead it is given and keeps its own state,
// so a caller shows another lead with another `key`. A removed lead is
// read-only (the server refuses every change to it). The on...Saved callbacks
// tell the list to update that lead's row.

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200";
const sectionLabelCls = "text-xs font-heading font-bold uppercase tracking-wide text-slate-500";

// A note being written in the Notes box: the box text, the note's id (picked
// here at its first save, so every save of it is the same repeatable request)
// and the text the server last stored.
type NoteDraft = {
  text: string;
  noteId: string | null;
  saved: string;
  row: WebsiteLeadNoteRow | null;
  retried: boolean;
};

function newDraft(): NoteDraft {
  return { text: "", noteId: null, saved: "", row: null, retried: false };
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

// How long "Saved ✓" stays beside the Stage and Assigned to fields.
const SAVED_CUE_MS = 2000;

export default function LeadManagement({
  lead,
  reps,
  labelCatalog,
  stageCatalog,
  currentUserId,
  isAdmin,
  onStageSaved,
  onAssigneeSaved,
  onLabelsSaved,
  onLabelCreated,
}: {
  lead: WebsiteLeadDetail;
  reps: Rep[];
  labelCatalog: MetaLeadLabelChip[];
  stageCatalog: MetaLeadStageRow[];
  currentUserId: string;
  isAdmin: boolean;
  onStageSaved?: (stage: string) => void;
  onAssigneeSaved?: (userId: string | null) => void;
  onLabelsSaved?: (labels: MetaLeadLabelChip[]) => void;
  onLabelCreated?: (label: MetaLeadLabelChip) => void;
}) {
  const toast = useToast();
  const base = `/api/website-leads/${lead.id}`;
  const removed = lead.removedAt != null;

  // --- Stage and rep -------------------------------------------------------
  const [stage, setStage] = useState(lead.stage);
  const [savingStage, setSavingStage] = useState(false);
  const [assignedToUserId, setAssignedToUserId] = useState<string | null>(lead.assignedToUserId);
  const [savingAssignee, setSavingAssignee] = useState(false);
  const stageKnown = stageCatalog.some((s) => s.slug === stage);
  // Each field's "Saved ✓" cue: shown for a moment after its save lands.
  const [stageSaved, setStageSaved] = useState(false);
  const [assigneeSaved, setAssigneeSaved] = useState(false);
  const stageCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assigneeCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (stageCueTimerRef.current) clearTimeout(stageCueTimerRef.current);
      if (assigneeCueTimerRef.current) clearTimeout(assigneeCueTimerRef.current);
    };
  }, []);

  // Hide a field's cue (and stop its timer), or show it until the timer runs out.
  function setSavedCue(
    timer: { current: ReturnType<typeof setTimeout> | null },
    set: (v: boolean) => void,
    show: boolean,
  ) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    set(show);
    if (show && mountedRef.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        set(false);
      }, SAVED_CUE_MS);
    }
  }

  async function patch(payload: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(base, {
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
    setSavedCue(stageCueTimerRef, setStageSaved, false);
    setStage(next);
    setSavingStage(true);
    const ok = await patch({ stage: next });
    setSavingStage(false);
    if (!ok) {
      setStage(prev);
      toast.error("Could not update the stage");
      return;
    }
    setSavedCue(stageCueTimerRef, setStageSaved, true);
    onStageSaved?.(next);
  }

  async function onAssigneeChange(next: string) {
    const prev = assignedToUserId;
    setSavedCue(assigneeCueTimerRef, setAssigneeSaved, false);
    setAssignedToUserId(next || null);
    setSavingAssignee(true);
    const ok = await patch({ assignedToUserId: next || null });
    setSavingAssignee(false);
    if (!ok) {
      setAssignedToUserId(prev);
      toast.error("Could not update the rep");
      return;
    }
    setSavedCue(assigneeCueTimerRef, setAssigneeSaved, true);
    onAssigneeSaved?.(next || null);
  }

  // --- Labels --------------------------------------------------------------
  const [catalog, setCatalog] = useState<MetaLeadLabelChip[]>(labelCatalog);
  const [applied, setApplied] = useState<MetaLeadLabelChip[]>(lead.labels);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState<string>("blue");
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [savingLabels, setSavingLabels] = useState(false);
  const appliedIds = useMemo(() => new Set(applied.map((l) => l.id)), [applied]);
  const available = useMemo(() => catalog.filter((l) => !appliedIds.has(l.id)), [catalog, appliedIds]);

  async function saveLabels(next: MetaLeadLabelChip[]) {
    const prev = applied;
    setApplied(next);
    setSavingLabels(true);
    let ok = false;
    try {
      const res = await fetch(`${base}/labels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelIds: next.map((l) => l.id) }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    setSavingLabels(false);
    if (!ok) {
      setApplied(prev);
      toast.error("Could not update labels");
      return;
    }
    onLabelsSaved?.(next);
  }

  function addLabel(label: MetaLeadLabelChip) {
    if (appliedIds.has(label.id)) return;
    void saveLabels([...applied, label]);
  }

  async function createAndAddLabel() {
    const name = newLabelName.trim();
    if (!name) return;
    setCreatingLabel(true);
    try {
      // The label list is shared with ad leads, so a new label shows up there too.
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
      onLabelCreated?.(label);
      setNewLabelName("");
      addLabel(label);
    } catch {
      toast.error("Could not create the label");
    } finally {
      setCreatingLabel(false);
    }
  }

  // --- Notes ---------------------------------------------------------------
  // The box saves itself: 2s after typing stops (or when it loses focus) the
  // text is saved as a note, and further typing keeps updating that same note.
  // "Save note" — or leaving the page — finishes it; the next words start a new
  // note. Emptying the box removes the half-written note.
  const [notes, setNotes] = useState<WebsiteLeadNoteRow[]>(lead.internalNotes);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteStatus, setNoteStatus] = useState<"idle" | "saving" | "saved" | "retrying" | "error">("idle");
  const [savingNote, setSavingNote] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<NoteDraft>(newDraft());
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const noteBusyRef = useRef(false);

  // Bring the server in line with one draft: save its note (PUT to the id picked
  // here, which creates it the first time and updates it after), or remove it
  // when the box was emptied. keepalive lets a save in flight land even if the
  // page closes meanwhile. Never throws; false = not saved. `force` sends even
  // when the text matches the last confirmed save.
  async function syncDraft(d: NoteDraft, force = false): Promise<boolean> {
    const body = d.text.trim();
    if (!force && body === d.saved) return true;
    const notesUrl = `${base}/notes`;
    try {
      if (!body) {
        if (!d.noteId) return true;
        const gone = d.noteId;
        const res = await fetch(`${notesUrl}/${gone}`, { method: "DELETE", keepalive: true });
        if (!res.ok && res.status !== 404) return false;
        if (d.noteId === gone) {
          d.noteId = null;
          d.saved = "";
          d.row = null;
        }
        setNotes((n) => n.filter((x) => x.id !== gone));
        return true;
      }
      if (!d.noteId) d.noteId = newNoteId();
      const id = d.noteId;
      const res = await fetch(`${notesUrl}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
        keepalive: true,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.note) return false;
      const row = data.note as WebsiteLeadNoteRow;
      if (d.noteId === id) {
        d.saved = body;
        d.row = row;
      }
      setNotes((n) => (n.some((x) => x.id === id) ? n.map((x) => (x.id === id ? row : x)) : [row, ...n]));
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
    if (!noteBusyRef.current && d.text.trim() === d.saved) return true;
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
    draftRef.current = newDraft();
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
      draftRef.current = newDraft();
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
      const res = await fetch(`${base}/notes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setNotes(prev);
        toast.error("Could not delete the note");
      }
    } catch {
      setNotes(prev);
      toast.error("Could not delete the note");
    }
  }

  // Leaving the page saves what's in the box. The save is sent at once rather
  // than queued — a queued one might never get its turn on a page that's going
  // away — which is safe because saving the same note twice can't make two notes.
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

  return (
    <section className="card p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-heading font-bold text-slate-900">Lead management</h2>
        <span className={`badge ${stageChipFromRow(stage, stageCatalog)}`}>{stageLabelFromRow(stage, stageCatalog)}</span>
      </div>

      {/* Stage */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="wl-detail-stage" className={sectionLabelCls}>
            Stage
          </label>
          <span className="text-[11px] text-slate-400" aria-live="polite">
            {savingStage && "Saving…"}
            {stageSaved && <span className="text-emerald-600 font-medium">Saved ✓</span>}
          </span>
        </div>
        <select
          id="wl-detail-stage"
          className={inputCls}
          value={stage}
          disabled={savingStage || removed}
          onChange={(e) => void onStageChange(e.target.value)}
        >
          {!stageKnown && <option value={stage}>{stageLabelFromRow(stage, stageCatalog)}</option>}
          {stageCatalog.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Rep */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="wl-detail-rep" className={sectionLabelCls}>
            Assigned to
          </label>
          <span className="text-[11px] text-slate-400" aria-live="polite">
            {savingAssignee && "Saving…"}
            {assigneeSaved && <span className="text-emerald-600 font-medium">Saved ✓</span>}
          </span>
        </div>
        <select
          id="wl-detail-rep"
          className={inputCls}
          value={assignedToUserId ?? ""}
          disabled={savingAssignee || removed}
          onChange={(e) => void onAssigneeChange(e.target.value)}
        >
          <option value="">Unassigned</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          {assignedToUserId && !reps.some((r) => r.id === assignedToUserId) && (
            <option value={assignedToUserId}>{(lead.assignedToName ?? "Unknown user") + " (inactive)"}</option>
          )}
        </select>
      </div>

      {/* Labels */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={sectionLabelCls}>Labels</span>
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            disabled={removed}
            className="text-xs font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-40"
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
                  onClick={() => void saveLabels(applied.filter((x) => x.id !== l.id))}
                  disabled={savingLabels || creatingLabel || removed}
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
            disabled={removed}
            className={`${inputCls} resize-y disabled:opacity-60`}
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
                  {(n.authorUserId === currentUserId || isAdmin) && !removed && (
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
                  {n.authorName} • {fmtDateTimeIST(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
