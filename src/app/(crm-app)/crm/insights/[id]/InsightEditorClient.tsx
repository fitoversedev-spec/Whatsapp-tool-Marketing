"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import { useToast } from "@/components/Toast";
import ShareInsightModal from "../ShareInsightModal";

type Doc = { id: string; title: string; body: string; updatedAt: string };

const SAVE_DEBOUNCE = 1500;

export default function InsightEditorClient({ document: doc }: { document: Doc }) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState(doc.title);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showShare, setShowShare] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Start writing your insights..." }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({ inline: false }),
    ],
    content: doc.body || "",
    editorProps: {
      attributes: {
        class: "insight-editor-content outline-none min-h-[400px] px-6 py-4 prose prose-sm max-w-none prose-slate prose-headings:text-slate-900 prose-p:text-slate-700 prose-p:leading-relaxed",
      },
    },
  });

  const save = useCallback(async (newTitle: string, newBody: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/insights/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ title: newTitle, body: newBody }),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setSaveState("error");
    }
  }, [doc.id]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        save(title, editor.getHTML());
      }, SAVE_DEBOUNCE);
    };
    editor.on("update", handler);
    return () => { editor.off("update", handler); };
  }, [editor, title, save]);

  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (editor) save(title, editor.getHTML());
    }, SAVE_DEBOUNCE);
    return () => clearTimeout(saveTimer.current);
  }, [title, editor, save]);

  if (!editor) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/crm/insights" className="text-sm text-slate-500 hover:text-slate-700 shrink-0">
            ← Back
          </Link>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-lg font-semibold text-slate-900 bg-transparent border-0 outline-none flex-1 min-w-0 focus:ring-0"
            placeholder="Document title"
          />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-xs text-slate-400" aria-live="polite">
            {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}
          </div>
          <button
            onClick={() => setShowShare(true)}
            className="text-xs font-medium text-slate-600 hover:text-slate-800 border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50"
          >
            Share
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border-b border-slate-200 px-4 py-1.5 flex flex-wrap items-center gap-0.5 overflow-x-auto">
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <strong>B</strong>
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <em>I</em>
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
          <span className="underline">U</span>
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <span className="line-through">S</span>
        </ToolbarBtn>

        <ToolbarDivider />

        <ToolbarBtn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
          H1
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
          H2
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
          H3
        </ToolbarBtn>

        <ToolbarDivider />

        <ToolbarBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          •
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          1.
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
          "
        </ToolbarBtn>

        <ToolbarDivider />

        <ToolbarBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left">
          ≡
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center">
          ≡
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align right">
          ≡
        </ToolbarBtn>

        <ToolbarDivider />

        <ToolbarBtn
          active={false}
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          title="Insert table"
        >
          ⊞
        </ToolbarBtn>
        {editor.isActive("table") && (
          <>
            <ToolbarBtn active={false} onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row">
              +↓
            </ToolbarBtn>
            <ToolbarBtn active={false} onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column">
              +→
            </ToolbarBtn>
            <ToolbarBtn active={false} onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row">
              −↓
            </ToolbarBtn>
            <ToolbarBtn active={false} onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column">
              −→
            </ToolbarBtn>
            <ToolbarBtn active={false} onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table">
              ✕
            </ToolbarBtn>
          </>
        )}
        <ToolbarBtn active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
          —
        </ToolbarBtn>

        <ToolbarDivider />

        <ToolbarBtn active={false} onClick={() => editor.chain().focus().undo().run()} title="Undo">
          ↶
        </ToolbarBtn>
        <ToolbarBtn active={false} onClick={() => editor.chain().focus().redo().run()} title="Redo">
          ↷
        </ToolbarBtn>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto bg-white">
        <EditorContent editor={editor} />
      </div>

      {showShare && (
        <ShareInsightModal
          docId={doc.id}
          docTitle={title}
          onClose={() => setShowShare(false)}
        />
      )}

      <style jsx global>{`
        .insight-editor-content h1 {
          font-size: 1.75em;
          font-weight: 700;
          margin: 0.75em 0 0.4em;
        }
        .insight-editor-content h2 {
          font-size: 1.4em;
          font-weight: 600;
          margin: 0.6em 0 0.3em;
        }
        .insight-editor-content h3 {
          font-size: 1.15em;
          font-weight: 600;
          margin: 0.5em 0 0.25em;
        }
        .insight-editor-content ul {
          list-style-type: disc;
          padding-left: 1.5em;
          margin: 0.5em 0;
        }
        .insight-editor-content ol {
          list-style-type: decimal;
          padding-left: 1.5em;
          margin: 0.5em 0;
        }
        .insight-editor-content li {
          margin: 0.25em 0;
        }
        .insight-editor-content li p {
          margin: 0;
        }
        .insight-editor-content table {
          border-collapse: collapse;
          width: 100%;
          margin: 1em 0;
        }
        .insight-editor-content th,
        .insight-editor-content td {
          border: 1px solid #94a3b8;
          padding: 8px 12px;
          text-align: left;
        }
        .insight-editor-content th {
          background: #f1f5f9;
          font-weight: 600;
        }
        .insight-editor-content p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #94a3b8;
          pointer-events: none;
          height: 0;
        }
        .insight-editor-content img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
        }
        .insight-editor-content blockquote {
          border-left: 3px solid #cbd5e1;
          padding-left: 1em;
          color: #64748b;
        }
        .insight-editor-content hr {
          border: none;
          border-top: 1px solid #e2e8f0;
          margin: 1.5em 0;
        }
      `}</style>
    </div>
  );
}

function ToolbarBtn({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-8 h-8 flex items-center justify-center rounded text-sm font-medium transition-colors ${
        active ? "bg-slate-200 text-slate-900" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-slate-200 mx-1" />;
}
