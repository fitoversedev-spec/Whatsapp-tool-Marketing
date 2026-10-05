"use client";

// Insight on a customer — each rep saves their own private entries (rich text,
// like the Insights page): "+" starts a new one, Save keeps it as a separate
// entry, and any saved entry can be edited later. Admins and managers also see
// every other rep's entries, read-only.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useToast } from "@/components/Toast";

export type InsightRow = {
  id: string;
  title: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  authorUserId: string;
  authorName: string;
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const EXTENSIONS = [StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } })];

function ToolbarBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded text-sm font-medium ${
        active ? "bg-slate-200 text-slate-900" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-2 py-1">
      <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><strong>B</strong></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><em>I</em></ToolbarBtn>
      <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><span className="underline">U</span></ToolbarBtn>
      <div className="w-px h-4 bg-slate-200 mx-1" />
      <ToolbarBtn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading">H2</ToolbarBtn>
      <ToolbarBtn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Sub-heading">H3</ToolbarBtn>
      <div className="w-px h-4 bg-slate-200 mx-1" />
      <ToolbarBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">•</ToolbarBtn>
      <ToolbarBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">1.</ToolbarBtn>
      <ToolbarBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">&ldquo;</ToolbarBtn>
      <div className="w-px h-4 bg-slate-200 mx-1" />
      <ToolbarBtn active={false} onClick={() => editor.chain().focus().undo().run()} title="Undo">↶</ToolbarBtn>
      <ToolbarBtn active={false} onClick={() => editor.chain().focus().redo().run()} title="Redo">↷</ToolbarBtn>
    </div>
  );
}

// Add / edit form: optional title + rich-text editor, saved only on Save.
function InsightForm({
  initial, saving, onCancel, onSave,
}: {
  initial: { title: string; body: string };
  saving: boolean;
  onCancel: () => void;
  onSave: (v: { title: string; body: string }) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [empty, setEmpty] = useState(!initial.body);
  const editor = useEditor({
    // Rendered on the server first (Next app router) — TipTap must wait for the client.
    immediatelyRender: false,
    autofocus: "end",
    extensions: [...EXTENSIONS, Placeholder.configure({ placeholder: "What do you know about this customer? Needs, budget, decision makers, objections, competitors…" })],
    content: initial.body || "",
    editorProps: { attributes: { class: "contact-insight-content outline-none min-h-[140px] px-4 py-3" } },
    onUpdate: ({ editor: e }) => setEmpty(e.isEmpty),
  });

  function save() {
    if (!editor || (editor.isEmpty && !title.trim())) return;
    onSave({ title: title.trim(), body: editor.isEmpty ? "" : editor.getHTML() });
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="w-full border-0 border-b border-slate-200 px-4 py-2 text-sm font-medium focus:outline-none focus:border-court-500 bg-transparent"
      />
      {editor ? <Toolbar editor={editor} /> : <div className="h-9 border-b border-slate-200" />}
      <EditorContent editor={editor} />
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <span className="text-xs text-slate-500">🔒 Private — only you and admins/managers can read this.</span>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={saving} className="btn btn-ghost !px-3 !py-1.5 !text-sm">Cancel</button>
          <button onClick={save} disabled={saving || (empty && !title.trim())} className="btn btn-primary !px-3 !py-1.5 !text-sm disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// A saved insight, rendered read-only through the same editor schema — never
// as raw HTML, so whatever was pasted in can't run as markup here.
function InsightBody({ body }: { body: string }) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: EXTENSIONS,
    content: body,
    editorProps: { attributes: { class: "contact-insight-content" } },
  });
  return <EditorContent editor={editor} />;
}

export default function ContactInsightSection({
  contactId, insights, viewerId, canModerate, addSignal,
}: {
  contactId: string;
  insights: InsightRow[];
  viewerId: string;
  // Admins/managers: also see every other rep's entries, read-only.
  canModerate: boolean;
  // Bumped by the left-nav "+" to open the add form here.
  addSignal: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (addSignal > 0) setAdding(true);
  }, [addSignal]);

  const mine = insights.filter((i) => i.authorUserId === viewerId);
  const others = insights.filter((i) => i.authorUserId !== viewerId);

  async function send(url: string, method: string, body: unknown, ok: string): Promise<boolean> {
    setBusy(true);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    if (res.ok) {
      toast.success(ok);
      router.refresh();
      return true;
    }
    const err = await res.json().catch(() => ({}));
    toast.error(err.error ?? "Could not save insight");
    return false;
  }

  async function add(v: { title: string; body: string }) {
    if (await send(`/api/account-contacts/${contactId}/insights`, "POST", v, "Insight saved")) setAdding(false);
  }

  async function update(id: string, v: { title: string; body: string }) {
    if (await send(`/api/account-contacts/${contactId}/insights/${id}`, "PATCH", { title: v.title || null, body: v.body }, "Insight updated")) setEditingId(null);
  }

  async function remove(i: InsightRow) {
    if (!confirm("Delete this insight? The Timeline will still show it was added and deleted.")) return;
    await send(`/api/account-contacts/${contactId}/insights/${i.id}`, "DELETE", null, "Insight deleted");
  }

  function card(i: InsightRow, editable: boolean) {
    if (editingId === i.id) {
      return (
        <InsightForm
          key={i.id}
          initial={{ title: i.title ?? "", body: i.body }}
          saving={busy}
          onCancel={() => setEditingId(null)}
          onSave={(v) => update(i.id, v)}
        />
      );
    }
    const edited = new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime() > 1000;
    return (
      <div key={i.id} className="rounded-lg border border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {i.title && <div className="text-sm font-semibold text-slate-900">{i.title}</div>}
            <div className="text-xs text-slate-500">
              {i.authorUserId !== viewerId && <span className="font-medium text-slate-700">{i.authorName} · </span>}
              <span className="font-mono">{fmtDateTime(i.createdAt)}</span>
              {edited && <span title={`Edited ${fmtDateTime(i.updatedAt)}`}> · edited</span>}
            </div>
          </div>
          {editable && (
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setEditingId(i.id)} className="text-xs font-medium text-slate-500 hover:text-slate-700">Edit</button>
              <button onClick={() => remove(i)} className="text-xs font-medium text-red-500 hover:text-red-700">Delete</button>
            </div>
          )}
        </div>
        <div className="mt-1.5 text-sm text-slate-700">
          <InsightBody body={i.body} />
        </div>
      </div>
    );
  }

  return (
    <div id="insight" className="card p-4 scroll-mt-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-semibold text-slate-900">
          Insight <span className="text-slate-400 font-normal font-mono">{mine.length}</span>
        </h3>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            aria-label="Add insight"
            title="Add insight"
            className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none"
          >
            +
          </button>
        )}
      </div>
      <p className="text-sm text-slate-600 mb-3">Your private notes on this customer. Each save is kept as its own entry.</p>

      {adding && (
        <div className="mb-3">
          <InsightForm initial={{ title: "", body: "" }} saving={busy} onCancel={() => setAdding(false)} onSave={add} />
        </div>
      )}

      {mine.length === 0 && !adding ? (
        <p className="text-sm text-slate-400">No insight saved yet.</p>
      ) : (
        <div className="space-y-2">{mine.map((i) => card(i, true))}</div>
      )}

      {canModerate && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Other reps&apos; insights</div>
          {others.length === 0 ? (
            <p className="text-sm text-slate-400">No other rep has saved an insight on this customer yet.</p>
          ) : (
            <div className="space-y-2">{others.map((i) => card(i, false))}</div>
          )}
        </div>
      )}

      <style jsx global>{`
        .contact-insight-content h2 { font-size: 1.2em; font-weight: 600; margin: 0.6em 0 0.3em; }
        .contact-insight-content h3 { font-size: 1.05em; font-weight: 600; margin: 0.5em 0 0.25em; }
        .contact-insight-content p { margin: 0.25em 0; }
        .contact-insight-content ul { list-style-type: disc; padding-left: 1.5em; margin: 0.4em 0; }
        .contact-insight-content ol { list-style-type: decimal; padding-left: 1.5em; margin: 0.4em 0; }
        .contact-insight-content li p { margin: 0; }
        .contact-insight-content blockquote { border-left: 3px solid #cbd5e1; padding-left: 1em; color: #64748b; }
        .contact-insight-content a { color: #0284c7; text-decoration: underline; }
        .contact-insight-content p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #94a3b8;
          pointer-events: none;
          height: 0;
        }
      `}</style>
    </div>
  );
}
