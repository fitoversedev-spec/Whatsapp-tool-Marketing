"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type PdfSection,
  type PdfSectionType,
  type ListStyle,
  SECTION_LABELS,
  sectionCategory,
} from "@/lib/quotation/section-types";

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Props ───────────────────────────────────────────────────────────────────

type Props = {
  sections: PdfSection[];
  onChange: (sections: PdfSection[]) => void;
  sport: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function badgeClass(type: PdfSectionType) {
  const cat = sectionCategory(type);
  if (cat === "auto")
    return "bg-blue-100 text-blue-700";
  if (cat === "custom")
    return "bg-emerald-100 text-emerald-700";
  return "bg-amber-100 text-amber-700";
}

function badgeLabel(type: PdfSectionType) {
  const cat = sectionCategory(type);
  if (cat === "auto") return "Auto";
  if (cat === "custom") return type === "photo" ? "Photo" : "Custom";
  return "Editable";
}

// ── Rich textarea with formatting toolbar ──────────────────────────────────

function RichTextarea({
  value,
  onChange,
  rows = 4,
  className = "input text-sm w-full resize-y font-mono",
  placeholder,
  listStyle,
  onListStyleChange,
}: {
  value: string;
  onChange: (val: string) => void;
  rows?: number;
  className?: string;
  placeholder?: string;
  listStyle?: ListStyle;
  onListStyleChange?: (s: ListStyle) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  function wrapSelection(pre: string, suf: string) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    if (s === e) return;
    const sel = value.slice(s, e);
    if (sel.startsWith(pre) && sel.endsWith(suf)) {
      const unwrapped = sel.slice(pre.length, -suf.length);
      onChange(value.slice(0, s) + unwrapped + value.slice(e));
      requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s, s + unwrapped.length); });
    } else {
      onChange(value.slice(0, s) + pre + sel + suf + value.slice(e));
      requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s, e + pre.length + suf.length); });
    }
  }

  function toggleListPrefix(
    makePfx: (line: string, n: number) => string,
    detect: (line: string) => boolean,
  ) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const before = value.slice(0, s);
    const startLine = (before.match(/\n/g) || []).length;
    const endLine = startLine + ((value.slice(s, e).match(/\n/g) || []).length);
    const lines = value.split("\n");
    const sel = lines.slice(startLine, endLine + 1).filter((l) => l.trim());
    const allPrefixed = sel.length > 0 && sel.every(detect);
    let num = 1;
    const out = lines.map((l, i) => {
      if (i < startLine || i > endLine || !l.trim()) return l;
      const stripped = l.replace(/^(• |\d+\.\s)/, "");
      return allPrefixed ? stripped : makePfx(stripped, num++);
    });
    onChange(out.join("\n"));
    requestAnimationFrame(() => ta.focus());
  }

  return (
    <div>
      <div className="flex items-center gap-0.5 px-2 py-1 bg-slate-100/80 border border-slate-200 rounded-t-lg">
        <button
          type="button"
          onClick={() => wrapSelection("**", "**")}
          className="px-2 py-1 rounded text-xs font-bold text-slate-700 hover:bg-slate-200"
          title="Bold (**text**)"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => wrapSelection("==", "==")}
          className="px-2 py-1 rounded text-xs hover:bg-yellow-100"
          title="Highlight (==text==)"
        >
          <span className="bg-yellow-200/80 text-slate-700 px-1.5 rounded font-medium">H</span>
        </button>

        <div className="w-px h-4 bg-slate-300 mx-1" />

        {/* Bullet list */}
        <button
          type="button"
          onClick={() => toggleListPrefix((l) => `• ${l}`, (l) => l.startsWith("• "))}
          className="p-1.5 rounded text-slate-600 hover:bg-slate-200"
          title="Bullet list"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
            <circle cx="4" cy="6" r="2" />
            <circle cx="4" cy="12" r="2" />
            <circle cx="4" cy="18" r="2" />
            <line x1="10" y1="6" x2="21" y2="6" strokeWidth="2" />
            <line x1="10" y1="12" x2="21" y2="12" strokeWidth="2" />
            <line x1="10" y1="18" x2="21" y2="18" strokeWidth="2" />
          </svg>
        </button>

        {/* Numbered list */}
        <button
          type="button"
          onClick={() => toggleListPrefix((_l, n) => `${n}. ${_l}`, (l) => /^\d+\.\s/.test(l))}
          className="p-1.5 rounded text-slate-600 hover:bg-slate-200"
          title="Numbered list"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
            <line x1="11" y1="6" x2="21" y2="6" />
            <line x1="11" y1="12" x2="21" y2="12" />
            <line x1="11" y1="18" x2="21" y2="18" />
            <text x="1" y="9" fontSize="9" stroke="none" fontFamily="system-ui">1</text>
            <text x="1" y="15" fontSize="9" stroke="none" fontFamily="system-ui">2</text>
            <text x="1" y="21" fontSize="9" stroke="none" fontFamily="system-ui">3</text>
          </svg>
        </button>

        {/* List style selector for notes/client_scope */}
        {listStyle !== undefined && onListStyleChange && (
          <>
            <div className="w-px h-4 bg-slate-300 mx-1" />
            <select
              value={listStyle}
              onChange={(e) => onListStyleChange(e.target.value as ListStyle)}
              className="text-xs bg-transparent text-slate-600 border-none outline-none cursor-pointer py-1"
            >
              <option value="bullet">Bullets in PDF</option>
              <option value="numbered">Numbered in PDF</option>
              <option value="none">Plain in PDF</option>
            </select>
          </>
        )}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={`${className} rounded-t-none border-t-0`}
        placeholder={placeholder}
      />
    </div>
  );
}

// ── Sortable card ───────────────────────────────────────────────────────────

function SortableSection({
  section,
  isFirst,
  isLast,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  section: PdfSection;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (s: PdfSection) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });
  const [expanded, setExpanded] = useState(false);
  const cat = sectionCategory(section.type);
  const canEdit = cat !== "auto";
  const canDelete = cat === "custom";

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="mb-1.5">
      <div
        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm
          ${section.highlighted ? "border-emerald-400 bg-emerald-50/40" : "border-slate-200 bg-white"}
          ${!section.visible ? "opacity-50" : ""}`}
      >
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 touch-none"
          aria-label="Drag to reorder"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="5" r="1.5" />
            <circle cx="15" cy="5" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="19" r="1.5" />
            <circle cx="15" cy="19" r="1.5" />
          </svg>
        </button>

        {/* Name + badge */}
        <span className="font-medium text-slate-800 flex-1 truncate">
          {SECTION_LABELS[section.type]}
          {section.type === "custom_text" && "title" in section
            ? `: ${(section as Extract<PdfSection, { type: "custom_text" }>).title || "Untitled"}`
            : ""}
        </span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeClass(section.type)}`}>
          {badgeLabel(section.type)}
        </span>

        {/* Controls */}
        <div className="flex items-center gap-1 ml-1">
          {/* Highlight toggle */}
          {canEdit && (
            <button
              onClick={() => onUpdate({ ...section, highlighted: !section.highlighted })}
              className={`p-1 rounded ${section.highlighted ? "text-emerald-600" : "text-slate-400 hover:text-slate-600"}`}
              title="Highlight section"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={section.highlighted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          )}

          {/* Visibility toggle */}
          <button
            onClick={() => onUpdate({ ...section, visible: !section.visible })}
            className={`p-1 rounded ${section.visible ? "text-slate-500 hover:text-slate-700" : "text-slate-300"}`}
            title={section.visible ? "Hide section" : "Show section"}
          >
            {section.visible ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
            )}
          </button>

          {/* Edit toggle */}
          {canEdit && (
            <button
              onClick={() => setExpanded(!expanded)}
              className={`p-1 rounded ${expanded ? "text-court-600" : "text-slate-400 hover:text-slate-600"}`}
              title="Edit section content"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </button>
          )}

          {/* Up/Down */}
          <button onClick={onMoveUp} disabled={isFirst} className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30" title="Move up">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
          </button>
          <button onClick={onMoveDown} disabled={isLast} className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30" title="Move down">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
          </button>

          {/* Delete */}
          {canDelete && (
            <button onClick={onRemove} className="p-1 rounded text-red-400 hover:text-red-600" title="Remove section">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && canEdit && (
        <div className="mt-1 ml-6 mr-1 p-3 rounded-lg border border-court-200 bg-court-50/30">
          <SectionInlineEditor section={section} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
}

// ── Per-type inline editors ─────────────────────────────────────────────────

function SectionInlineEditor({
  section,
  onUpdate,
}: {
  section: PdfSection;
  onUpdate: (s: PdfSection) => void;
}) {
  switch (section.type) {
    case "cover":
      return <CoverEditor section={section} onUpdate={onUpdate} />;
    case "notes":
    case "client_scope":
      return <LinesEditor section={section} onUpdate={onUpdate} />;
    case "payment_terms":
      return <MilestoneEditor section={section} onUpdate={onUpdate} />;
    case "bank_details":
      return <KeyValueEditor section={section} onUpdate={onUpdate} />;
    case "terms":
      return <TermsEditor section={section} onUpdate={onUpdate} />;
    case "signatures":
      return <SignatureEditor section={section} onUpdate={onUpdate} />;
    case "advantage":
      return <AdvantageEditor section={section} onUpdate={onUpdate} />;
    case "connect":
      return <ConnectEditor section={section} onUpdate={onUpdate} />;
    case "photo":
      return <PhotoEditor section={section} onUpdate={onUpdate} />;
    case "custom_text":
      return <CustomTextEditor section={section} onUpdate={onUpdate} />;
    default:
      return null;
  }
}

// ── Cover editor ────────────────────────────────────────────────────────────

function CoverEditor({
  section,
  onUpdate,
}: {
  section: Extract<PdfSection, { type: "cover" }>;
  onUpdate: (s: PdfSection) => void;
}) {
  const up = (field: string, value: string) =>
    onUpdate({ ...section, [field]: value });

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-600">Company name</label>
      <input value={section.companyName} onChange={(e) => up("companyName", e.target.value)} className="input text-sm" />
      <label className="block text-xs font-medium text-slate-600">GSTIN</label>
      <input value={section.gstin} onChange={(e) => up("gstin", e.target.value)} className="input text-sm" />
      <label className="block text-xs font-medium text-slate-600">CIN</label>
      <input value={section.cin} onChange={(e) => up("cin", e.target.value)} className="input text-sm" />
      <label className="block text-xs font-medium text-slate-600">Phone</label>
      <input value={section.phone} onChange={(e) => up("phone", e.target.value)} className="input text-sm" />
      <label className="block text-xs font-medium text-slate-600">Cities</label>
      <input value={section.cities} onChange={(e) => up("cities", e.target.value)} className="input text-sm" />
      <label className="block text-xs font-medium text-slate-600">Project title override (optional)</label>
      <input value={section.projectTitle ?? ""} onChange={(e) => up("projectTitle", e.target.value)} className="input text-sm" placeholder="Auto-generated from sport + dimensions" />
    </div>
  );
}

// ── Lines editor (notes, client scope) ──────────────────────────────────────

function LinesEditor({
  section,
  onUpdate,
}: {
  section: Extract<PdfSection, { type: "notes" | "client_scope" }>;
  onUpdate: (s: PdfSection) => void;
}) {
  const text = section.lines.join("\n");
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        One line per point — use toolbar to format
      </label>
      <RichTextarea
        value={text}
        onChange={(v) => onUpdate({ ...section, lines: v.split("\n") })}
        rows={Math.max(3, section.lines.length + 1)}
        listStyle={section.listStyle ?? (section.type === "notes" ? "numbered" : "bullet")}
        onListStyleChange={(s) => onUpdate({ ...section, listStyle: s })}
      />
    </div>
  );
}

// ── Milestone editor (payment terms) ────────────────────────────────────────

function MilestoneEditor({
  section,
  onUpdate,
}: {
  section: Extract<PdfSection, { type: "payment_terms" }>;
  onUpdate: (s: PdfSection) => void;
}) {
  const update = (i: number, col: 0 | 1, val: string) => {
    const next = section.milestones.map((m, j) =>
      j === i ? ([col === 0 ? val : m[0], col === 1 ? val : m[1]] as [string, string]) : m,
    );
    onUpdate({ ...section, milestones: next });
  };
  const add = () =>
    onUpdate({ ...section, milestones: [...section.milestones, ["", ""]] });
  const remove = (i: number) =>
    onUpdate({ ...section, milestones: section.milestones.filter((_, j) => j !== i) });

  return (
    <div className="space-y-2">
      {section.milestones.map(([pct, desc], i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={pct} onChange={(e) => update(i, 0, e.target.value)} className="input text-sm w-20" placeholder="50%" />
          <input value={desc} onChange={(e) => update(i, 1, e.target.value)} className="input text-sm flex-1" placeholder="Description" />
          <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 p-1" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-court-600 hover:text-court-800 font-medium">
        + Add milestone
      </button>
    </div>
  );
}

// ── Key-value editor (bank details) ─────────────────────────────────────────

function KeyValueEditor({
  section,
  onUpdate,
}: {
  section: Extract<PdfSection, { type: "bank_details" }>;
  onUpdate: (s: PdfSection) => void;
}) {
  const update = (i: number, col: 0 | 1, val: string) => {
    const next = section.rows.map((r, j) =>
      j === i ? ([col === 0 ? val : r[0], col === 1 ? val : r[1]] as [string, string]) : r,
    );
    onUpdate({ ...section, rows: next });
  };
  const add = () =>
    onUpdate({ ...section, rows: [...section.rows, ["", ""]] });
  const remove = (i: number) =>
    onUpdate({ ...section, rows: section.rows.filter((_, j) => j !== i) });

  return (
    <div className="space-y-2">
      {section.rows.map(([label, value], i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={label} onChange={(e) => update(i, 0, e.target.value)} className="input text-sm w-36" placeholder="Label" />
          <input value={value} onChange={(e) => update(i, 1, e.target.value)} className="input text-sm flex-1" placeholder="Value" />
          <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 p-1" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-court-600 hover:text-court-800 font-medium">
        + Add row
      </button>
    </div>
  );
}

// ── Terms editor ────────────────────────────────────────────────────────────

function TermsEditor({
  section,
  onUpdate,
}: {
  section: Extract<PdfSection, { type: "terms" }>;
  onUpdate: (s: PdfSection) => void;
}) {
  const update = (i: number, field: "title" | "body", val: string) => {
    const next = section.clauses.map((c, j) =>
      j === i ? { ...c, [field]: val } : c,
    );
    onUpdate({ ...section, clauses: next });
  };
  const add = () =>
    onUpdate({ ...section, clauses: [...section.clauses, { title: "", body: "" }] });
  const remove = (i: number) =>
    onUpdate({ ...section, clauses: section.clauses.filter((_, j) => j !== i) });

  return (
    <div className="space-y-3">
      {section.clauses.map((c, i) => (
        <div key={i} className="p-2 border border-slate-200 rounded-lg bg-white space-y-1.5">
          <div className="flex items-center gap-2">
            <input value={c.title} onChange={(e) => update(i, "title", e.target.value)} className="input text-sm flex-1 font-medium" placeholder="Clause title" />
            <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 p-1" title="Remove clause">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <RichTextarea value={c.body} onChange={(v) => update(i, "body", v)} rows={3} className="input text-sm w-full resize-y" placeholder="Clause body" />
        </div>
      ))}
      <button onClick={add} className="text-xs text-court-600 hover:text-court-800 font-medium">
        + Add clause
      </button>
    </div>
  );
}

// ── Signature editor ────────────────────────────────────────────────────────

function SignatureEditor({
  section,
  onUpdate,
}: {
  section: Extract<PdfSection, { type: "signatures" }>;
  onUpdate: (s: PdfSection) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-600">Director name</label>
      <input value={section.directorName} onChange={(e) => onUpdate({ ...section, directorName: e.target.value })} className="input text-sm" />
      <label className="block text-xs font-medium text-slate-600">Title</label>
      <input value={section.directorTitle} onChange={(e) => onUpdate({ ...section, directorTitle: e.target.value })} className="input text-sm" />
    </div>
  );
}

// ── Advantage editor ────────────────────────────────────────────────────────

function AdvantageEditor({
  section,
  onUpdate,
}: {
  section: Extract<PdfSection, { type: "advantage" }>;
  onUpdate: (s: PdfSection) => void;
}) {
  const updateStat = (i: number, col: 0 | 1, val: string) => {
    const next = section.stats.map((s, j) =>
      j === i ? ([col === 0 ? val : s[0], col === 1 ? val : s[1]] as [string, string]) : s,
    );
    onUpdate({ ...section, stats: next });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Paragraphs (double newline to separate)</label>
        <RichTextarea
          value={section.paragraphs.join("\n\n")}
          onChange={(v) => onUpdate({ ...section, paragraphs: v.split("\n\n").filter(Boolean) })}
          rows={6}
          className="input text-sm w-full resize-y"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Memberships</label>
          <input value={section.memberships} onChange={(e) => onUpdate({ ...section, memberships: e.target.value })} className="input text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Certifications</label>
          <input value={section.certifications} onChange={(e) => onUpdate({ ...section, certifications: e.target.value })} className="input text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Stats</label>
        {section.stats.map(([val, label], i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <input value={val} onChange={(e) => updateStat(i, 0, e.target.value)} className="input text-sm w-28 font-bold" placeholder="65+" />
            <input value={label} onChange={(e) => updateStat(i, 1, e.target.value)} className="input text-sm flex-1" placeholder="infra projects" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Connect editor ──────────────────────────────────────────────────────────

function ConnectEditor({
  section,
  onUpdate,
}: {
  section: Extract<PdfSection, { type: "connect" }>;
  onUpdate: (s: PdfSection) => void;
}) {
  const updateLink = (i: number, col: 0 | 1 | 2, val: string) => {
    const next = section.socialLinks.map((l, j) =>
      j === i
        ? ([col === 0 ? val : l[0], col === 1 ? val : l[1], col === 2 ? val : l[2]] as [string, string, string])
        : l,
    );
    onUpdate({ ...section, socialLinks: next });
  };
  const add = () =>
    onUpdate({ ...section, socialLinks: [...section.socialLinks, ["", "", ""]] });
  const remove = (i: number) =>
    onUpdate({ ...section, socialLinks: section.socialLinks.filter((_, j) => j !== i) });

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-600">Phone number</label>
      <input value={section.phone} onChange={(e) => onUpdate({ ...section, phone: e.target.value })} className="input text-sm" />
      <label className="block text-xs font-medium text-slate-600 mt-2">Social links</label>
      {section.socialLinks.map(([platform, handle, url], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input value={platform} onChange={(e) => updateLink(i, 0, e.target.value)} className="input text-sm w-24" placeholder="Platform" />
          <input value={handle} onChange={(e) => updateLink(i, 1, e.target.value)} className="input text-sm w-32" placeholder="Handle" />
          <input value={url} onChange={(e) => updateLink(i, 2, e.target.value)} className="input text-sm flex-1" placeholder="URL" />
          <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 p-1" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-court-600 hover:text-court-800 font-medium">
        + Add link
      </button>
    </div>
  );
}

// ── Photo editor ────────────────────────────────────────────────────────────

function PhotoEditor({
  section,
  onUpdate,
}: {
  section: Extract<PdfSection, { type: "photo" }>;
  onUpdate: (s: PdfSection) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      onUpdate({ ...section, imageUrl: data.url });
    } catch {
      alert("Failed to upload image. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {section.imageUrl ? (
        <div className="relative">
          <img src={section.imageUrl} alt="Section photo" className="max-h-40 rounded-lg border border-slate-200 object-contain" />
          <button
            onClick={() => { onUpdate({ ...section, imageUrl: "" }); }}
            className="absolute top-1 right-1 bg-white/90 rounded-full p-1 text-red-500 hover:text-red-700 shadow"
            title="Remove photo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full py-6 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-court-400 hover:text-court-600 transition-colors"
        >
          {uploading ? "Uploading..." : "Click to upload photo"}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <label className="block text-xs font-medium text-slate-600">Caption (optional)</label>
      <input
        value={section.caption ?? ""}
        onChange={(e) => onUpdate({ ...section, caption: e.target.value })}
        className="input text-sm"
        placeholder="Photo caption"
      />
    </div>
  );
}

// ── Custom text editor ──────────────────────────────────────────────────────

function CustomTextEditor({
  section,
  onUpdate,
}: {
  section: Extract<PdfSection, { type: "custom_text" }>;
  onUpdate: (s: PdfSection) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-600">Section title</label>
      <input value={section.title} onChange={(e) => onUpdate({ ...section, title: e.target.value })} className="input text-sm font-medium" placeholder="Section title" />
      <label className="block text-xs font-medium text-slate-600">Content</label>
      <RichTextarea value={section.body} onChange={(v) => onUpdate({ ...section, body: v })} rows={4} className="input text-sm w-full resize-y" placeholder="Section content..." />
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function SectionEditor({ sections, onChange, sport }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sorted = [...sections].sort((a, b) => a.order - b.order);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.findIndex((s) => s.id === active.id);
    const newIndex = sorted.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(sorted, oldIndex, newIndex).map((s, i) => ({
      ...s,
      order: i,
    }));
    onChange(reordered);
  }

  function updateSection(updated: PdfSection) {
    onChange(sections.map((s) => (s.id === updated.id ? updated : s)));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const reordered = arrayMove(sorted, index, index - 1).map((s, i) => ({
      ...s,
      order: i,
    }));
    onChange(reordered);
  }

  function moveDown(index: number) {
    if (index >= sorted.length - 1) return;
    const reordered = arrayMove(sorted, index, index + 1).map((s, i) => ({
      ...s,
      order: i,
    }));
    onChange(reordered);
  }

  function removeSection(id: string) {
    const filtered = sections.filter((s) => s.id !== id).map((s, i) => ({
      ...s,
      order: i,
    }));
    onChange(filtered);
  }

  function addPhoto() {
    const maxOrder = sections.reduce((m, s) => Math.max(m, s.order), -1);
    onChange([
      ...sections,
      {
        id: genId(),
        type: "photo" as const,
        order: maxOrder + 1,
        highlighted: false,
        visible: true,
        imageUrl: "",
        caption: "",
      },
    ]);
  }

  function addCustomText() {
    const maxOrder = sections.reduce((m, s) => Math.max(m, s.order), -1);
    onChange([
      ...sections,
      {
        id: genId(),
        type: "custom_text" as const,
        order: maxOrder + 1,
        highlighted: false,
        visible: true,
        title: "",
        body: "",
      },
    ]);
  }

  return (
    <div>
      <div className="mb-3 text-sm text-slate-600">
        Drag to reorder, click edit to customize content. Hidden sections won't appear in the PDF.
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sorted.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {sorted.map((section, i) => (
            <SortableSection
              key={section.id}
              section={section}
              isFirst={i === 0}
              isLast={i === sorted.length - 1}
              onUpdate={updateSection}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
              onRemove={() => removeSection(section.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      <div className="mt-3 flex gap-2">
        <button
          onClick={addPhoto}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-court-400 hover:text-court-700 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
          Add photo section
        </button>
        <button
          onClick={addCustomText}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-court-400 hover:text-court-700 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
          Add custom section
        </button>
      </div>
    </div>
  );
}
