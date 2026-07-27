"use client";

// Team-chat composer: a contentEditable editor that turns @-typing into a
// suggestion popup and inserts picked items as non-editable chip spans, plus
// file attachment. On send it serializes the DOM back to @[refType:id:label]
// tokens (see tokens.ts). Once a customer is tagged (or the thread is anchored
// to a customer), the popup context locks so deals/quotes/designs narrow to it.
import { useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { serializeChip, type ChatRefType } from "@/lib/chat/tokens";
import MentionAutocomplete, { type MentionItem } from "./MentionAutocomplete";

type AttachmentRef = { fileName: string; fileUrl: string; fileSize: number; mimeType: string; category?: string };

export default function MessageComposer({
  entityType,
  entityId,
  initialCustomerContext,
  initialPersonContext,
  onSent,
}: {
  entityType: string;
  entityId: string;
  // accountContactId to seed the @ context (set when the thread IS a customer).
  initialCustomerContext: string | null;
  // userId to seed the @ person-scope (set when the thread is a DM with them).
  initialPersonContext: string | null;
  onSent: () => void;
}) {
  const toast = useToast();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<{ node: Text; atIndex: number; caretIndex: number } | null>(null);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [lockedCustomerId, setLockedCustomerId] = useState<string | null>(initialCustomerContext);
  const [lockedPersonId, setLockedPersonId] = useState<string | null>(initialPersonContext);
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [empty, setEmpty] = useState(true);

  function refreshEmpty() {
    const el = editorRef.current;
    setEmpty(!el || (el.textContent ?? "").trim().length === 0);
  }

  // Detect an active "@query" immediately before the collapsed caret.
  function detectMention() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return setMentionQuery(null);
    const range = sel.getRangeAt(0);
    if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return setMentionQuery(null);
    const node = range.startContainer as Text;
    const caret = range.startOffset;
    const upto = (node.textContent ?? "").slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at === -1) return setMentionQuery(null);
    const before = at === 0 ? " " : upto[at - 1];
    if (at !== 0 && !/\s/.test(before)) return setMentionQuery(null);
    const query = upto.slice(at + 1);
    if (/\s/.test(query)) return setMentionQuery(null);
    anchorRef.current = { node, atIndex: at, caretIndex: caret };
    setMentionQuery(query);
  }

  function onInput() {
    refreshEmpty();
    detectMention();
  }

  function pickMention(item: MentionItem) {
    const anchor = anchorRef.current;
    const el = editorRef.current;
    if (!anchor || !el) return;
    const { node, atIndex, caretIndex } = anchor;
    const full = node.textContent ?? "";
    node.textContent = full.slice(0, atIndex);

    const chip = document.createElement("span");
    chip.setAttribute("contenteditable", "false");
    chip.dataset.reftype = item.refType;
    chip.dataset.id = item.id;
    chip.dataset.label = item.label;
    chip.className = "inline-flex items-center rounded px-1 py-0.5 text-[13px] font-medium bg-wa-green/10 text-wa-dark mx-0.5";
    chip.textContent = `@${item.label}`;
    const space = document.createTextNode(" ");
    const after = document.createTextNode(full.slice(caretIndex));
    const parent = node.parentNode!;
    parent.insertBefore(after, node.nextSibling);
    parent.insertBefore(space, after);
    parent.insertBefore(chip, space);

    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(after, 0);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);

    if (item.refType === "accountContact" || item.refType === "lead") setLockedCustomerId(item.id);
    // Tagging a teammate scopes subsequent record suggestions to their records.
    if (item.refType === "user") setLockedPersonId(item.id);
    setMentionQuery(null);
    anchorRef.current = null;
    el.focus();
    refreshEmpty();
  }

  // DOM → @[refType:id:label] tokens.
  function serialize(el: Node): string {
    let out = "";
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent ?? "";
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const e = n as HTMLElement;
        if (e.dataset.reftype && e.dataset.id) {
          out += serializeChip(e.dataset.reftype as ChatRefType, e.dataset.id, e.dataset.label ?? "");
        } else if (e.tagName === "BR") {
          out += "\n";
        } else {
          if (e.tagName === "DIV") out += "\n";
          out += serialize(e);
        }
      }
    });
    return out;
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);
        const res = await fetch(`/api/chat/threads/${entityType}/${entityId}/attachments`, { method: "POST", body: form });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error ?? `Could not upload ${file.name}`);
          continue;
        }
        const { ref } = await res.json();
        setAttachments((a) => [...a, ref]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send() {
    const el = editorRef.current;
    if (!el || sending) return;
    const body = serialize(el).replace(/ /g, " ").replace(/\s+$/g, "").trim();
    if (!body && attachments.length === 0) return;
    setSending(true);
    try {
      const res = await fetch(`/api/chat/threads/${entityType}/${entityId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body || undefined, attachments: attachments.length ? attachments : undefined }),
      });
      if (!res.ok) {
        toast.error("Could not send message");
        return;
      }
      el.innerHTML = "";
      setAttachments([]);
      setLockedCustomerId(initialCustomerContext);
      setLockedPersonId(initialPersonContext);
      setMentionQuery(null);
      refreshEmpty();
      onSent();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-slate-200 p-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs bg-slate-100 rounded px-2 py-1 max-w-[180px]">
              <span className="truncate">📎 {a.fileName}</span>
              <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-slate-700">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        {mentionQuery !== null && (
          <MentionAutocomplete query={mentionQuery} contextCustomerId={lockedCustomerId} personId={lockedPersonId} onPick={pickMention} />
        )}
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Attach a file"
            className="shrink-0 w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50 text-lg"
          >
            {uploading ? "…" : "📎"}
          </button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          <div className="relative flex-1 min-w-0">
            {empty && (
              <span className="pointer-events-none absolute left-3 top-2 text-sm text-slate-400">
                Message… use @ to tag people or records
              </span>
            )}
            <div
              ref={editorRef}
              contentEditable
              role="textbox"
              aria-label="Message"
              onInput={onInput}
              onKeyUp={detectMention}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && mentionQuery === null) {
                  e.preventDefault();
                  send();
                }
                if (e.key === "Escape") setMentionQuery(null);
              }}
              className="min-h-[38px] max-h-40 overflow-y-auto rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-wa-green"
              suppressContentEditableWarning
            />
          </div>
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="shrink-0 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 h-9 text-sm font-medium disabled:opacity-50"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
