"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

type Template = {
  id: string;
  name: string;
  language: string;
  category: string;
  header: string | null;
  body: string;
  footer: string | null;
  status: string;
  rejectionReason: string | null;
  draftedByName: string;
  approvedByName: string | null;
  updatedAt: string;
  deletedAt: string | null;
};

type HeaderFormat = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

const HEADER_ACCEPT: Record<Exclude<HeaderFormat, "NONE" | "TEXT">, string> = {
  IMAGE: "image/jpeg,image/png",
  VIDEO: "video/mp4,video/3gpp",
  DOCUMENT: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt",
};

const HEADER_LIMIT_MB: Record<Exclude<HeaderFormat, "NONE" | "TEXT">, number> = {
  IMAGE: 5,
  VIDEO: 16,
  DOCUMENT: 100,
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  pending_admin: "bg-amber-100 text-amber-800",
  submitted: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  paused: "bg-orange-100 text-orange-800",
};

export default function TemplatesClient({
  currentUser,
  showDeleted,
  templates,
}: {
  currentUser: { role: "admin" | "sales" };
  showDeleted: boolean;
  templates: Template[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [showDraft, setShowDraft] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [syncing, setSyncing] = useState(false);

  const filtered = filter === "all" ? templates : templates.filter((t) => t.status === filter);

  async function act(id: string, action: "submit_for_review" | "submit_to_meta") {
    const res = await fetch(`/api/templates/${id}/${action}`, { method: "POST" });
    if (res.ok) {
      toast.success(action === "submit_for_review" ? "Submitted for admin review" : "Submitted to Meta");
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Action failed");
    }
  }

  // Soft-delete the template. Hides from default view but preserves the row
  // (and the underlying Meta template). Restorable from "Show deleted" view.
  async function softDelete(id: string, name: string) {
    if (!confirm(`Hide "${name}" from the template list?\n\nThe template will remain on Meta. You can restore it from the "Show deleted" view.`)) {
      return;
    }
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`"${name}" hidden`);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Delete failed");
    }
  }

  async function restore(id: string, name: string) {
    const res = await fetch(`/api/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore" }),
    });
    if (res.ok) {
      toast.success(`"${name}" restored`);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Restore failed");
    }
  }

  function toggleShowDeleted() {
    const url = new URL(window.location.href);
    if (showDeleted) {
      url.searchParams.delete("showDeleted");
    } else {
      url.searchParams.set("showDeleted", "1");
    }
    router.push(url.pathname + url.search);
  }

  // Manual reconciliation with Meta. Normally the
  // `message_template_status_update` webhook keeps statuses in sync, but if
  // the webhook misses an event (Meta only retries for a limited time)
  // admins can re-sync from here.
  async function syncFromMeta() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/templates/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Sync failed");
      } else {
        const { changed, unchanged } = data as { changed: number; unchanged: number };
        if (changed === 0) {
          toast.success(`All ${unchanged} template(s) already in sync with Meta`);
        } else {
          toast.success(`Synced ${changed} template(s) from Meta`);
        }
        router.refresh();
      }
    } catch (err) {
      toast.error("Sync request failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Templates"
        description="Message templates synced with Meta."
        action={
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {currentUser.role === "admin" && (
              <button
                onClick={syncFromMeta}
                disabled={syncing}
                className="bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-medium px-4 py-2 rounded-lg transition"
                title="Pull live status from Meta and update local DB"
              >
                {syncing ? "Syncing…" : "↻ Sync from Meta"}
              </button>
            )}
            <button
              onClick={() => setShowDraft(true)}
              className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg transition"
            >
              + New template
            </button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex gap-2 mb-4 sm:mb-6 overflow-x-auto pb-1 -mx-1 px-1 items-center">
          {["all", "draft", "pending_admin", "submitted", "approved", "rejected"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                filter === s
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {s.replace("_", " ")}
            </button>
          ))}
          {currentUser.role === "admin" && (
            <button
              onClick={toggleShowDeleted}
              className={`shrink-0 ml-2 px-3 py-1.5 rounded-lg text-sm font-medium transition border ${
                showDeleted
                  ? "bg-red-100 border-red-300 text-red-800"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
              title="Toggle visibility of soft-deleted templates"
            >
              {showDeleted ? "✓ Showing deleted" : "Show deleted"}
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center text-slate-500">
            No templates. Click <strong>New template</strong> to create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            {filtered.map((t) => (
              <div
                key={t.id}
                className={`border rounded-xl sm:rounded-2xl p-4 sm:p-5 ${
                  t.deletedAt
                    ? "bg-slate-50 border-slate-300 opacity-75"
                    : "bg-white border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{t.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {t.category} · {t.language}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`inline-block px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${
                        STATUS_COLORS[t.status] ?? "bg-slate-100"
                      }`}
                    >
                      {t.status.replace("_", " ")}
                    </span>
                    {t.deletedAt && (
                      <span className="inline-block px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap bg-slate-700 text-white">
                        Deleted
                      </span>
                    )}
                  </div>
                </div>
                <TemplateHeaderPreview header={t.header} />
                <div className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 mb-3 whitespace-pre-wrap font-mono text-xs break-words">
                  {t.body}
                </div>
                {t.footer && (
                  <div className="text-xs text-slate-500 italic mb-3 break-words">{t.footer}</div>
                )}
                {t.rejectionReason && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3 break-words">
                    Rejected: {t.rejectionReason}
                  </div>
                )}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-500">
                  <div>by {t.draftedByName}</div>
                  <div className="flex gap-2 flex-wrap">
                    {!t.deletedAt && t.status === "draft" && (
                      <button
                        onClick={() => act(t.id, "submit_for_review")}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 rounded text-slate-700 font-medium"
                      >
                        Submit for review
                      </button>
                    )}
                    {!t.deletedAt && t.status === "pending_admin" && currentUser.role === "admin" && (
                      <button
                        onClick={() => act(t.id, "submit_to_meta")}
                        className="px-3 py-1.5 bg-wa-green hover:bg-wa-green/90 active:bg-wa-green/80 text-white rounded font-medium"
                      >
                        Submit to Meta
                      </button>
                    )}
                    {!t.deletedAt && currentUser.role === "admin" && (
                      <button
                        onClick={() => softDelete(t.id, t.name)}
                        className="px-3 py-1.5 bg-white border border-red-200 hover:bg-red-50 active:bg-red-100 rounded text-red-700 font-medium"
                        title="Hide this template from the list (Meta-side template not affected)"
                      >
                        Delete
                      </button>
                    )}
                    {t.deletedAt && currentUser.role === "admin" && (
                      <button
                        onClick={() => restore(t.id, t.name)}
                        className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 active:bg-slate-200 rounded text-slate-700 font-medium"
                        title="Bring this template back into the active list"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showDraft && <DraftModal onClose={() => setShowDraft(false)} onSaved={() => router.refresh()} />}
    </>
  );
}

function DraftModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("MARKETING");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [saving, setSaving] = useState(false);

  // Header state
  const [headerFormat, setHeaderFormat] = useState<HeaderFormat>("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string | null>(null);
  const [headerFilename, setHeaderFilename] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (headerFormat === "NONE" || headerFormat === "TEXT") return;

    const limitBytes = HEADER_LIMIT_MB[headerFormat] * 1024 * 1024;
    if (file.size > limitBytes) {
      toast.error(`File too large. Max ${HEADER_LIMIT_MB[headerFormat]}MB for ${headerFormat}.`);
      e.target.value = "";
      return;
    }

    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("headerType", headerFormat);
    const res = await fetch("/api/templates/upload-media", { method: "POST", body: fd });
    setUploading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Upload failed");
      e.target.value = "";
      return;
    }
    setHeaderMediaUrl(data.url);
    setHeaderFilename(file.name);
    toast.success("Media uploaded — preview below");
  }

  function clearMedia() {
    setHeaderMediaUrl(null);
    setHeaderFilename(null);
  }

  function onHeaderFormatChange(next: HeaderFormat) {
    setHeaderFormat(next);
    setHeaderText("");
    setHeaderMediaUrl(null);
    setHeaderFilename(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();

    // Validate header
    let header: any = null;
    if (headerFormat === "TEXT") {
      if (!headerText.trim()) {
        toast.error("Header text is required when format is TEXT.");
        return;
      }
      header = { format: "TEXT", text: headerText.trim() };
    } else if (headerFormat !== "NONE") {
      if (!headerMediaUrl) {
        toast.error(`Upload a ${headerFormat.toLowerCase()} file before saving.`);
        return;
      }
      header = {
        format: headerFormat,
        url: headerMediaUrl,
        ...(headerFilename ? { filename: headerFilename } : {}),
      };
    }

    setSaving(true);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, language, category, body, footer: footer || null, header }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Template saved as draft");
      onSaved();
      onClose();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Save failed");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] overflow-y-auto"
      >
        <div className="p-5 sm:p-6 border-b border-slate-200 sticky top-0 bg-white">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">New template draft</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Use {"{{"}1{"}}"}, {"{{"}2{"}}"} for variables. Saves as <strong>draft</strong>.
          </p>
        </div>
        <div className="p-5 sm:p-6 space-y-4">
          <Field label="Name (lowercase, snake_case)" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              className="input"
              placeholder="promo_offer_may"
              pattern="[a-z0-9_]+"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Field label="Language">
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input">
                <option value="en">en</option>
                <option value="en_US">en_US</option>
                <option value="hi">hi</option>
                <option value="ta">ta</option>
              </select>
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="input"
              >
                <option value="MARKETING">MARKETING</option>
                <option value="UTILITY">UTILITY</option>
                <option value="AUTHENTICATION">AUTHENTICATION</option>
              </select>
            </Field>
          </div>

          <Field label="Header (optional)">
            <select
              value={headerFormat}
              onChange={(e) => onHeaderFormatChange(e.target.value as HeaderFormat)}
              className="input"
            >
              <option value="NONE">None</option>
              <option value="TEXT">Text</option>
              <option value="IMAGE">Image (max 5MB — JPEG/PNG)</option>
              <option value="VIDEO">Video (max 16MB — MP4/3GP)</option>
              <option value="DOCUMENT">Document (max 100MB — PDF/Office/TXT)</option>
            </select>
          </Field>

          {headerFormat === "TEXT" && (
            <Field label="Header text (max 60 chars)">
              <input
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                className="input"
                placeholder="Welcome to Fitoverse!"
                maxLength={60}
              />
            </Field>
          )}

          {(headerFormat === "IMAGE" || headerFormat === "VIDEO" || headerFormat === "DOCUMENT") && (
            <Field label={`Upload ${headerFormat.toLowerCase()}`}>
              {!headerMediaUrl ? (
                <div className="space-y-2">
                  <input
                    type="file"
                    accept={HEADER_ACCEPT[headerFormat]}
                    onChange={handleFileSelect}
                    disabled={uploading}
                    className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-50"
                  />
                  {uploading && (
                    <div className="text-xs text-slate-500">Uploading to Vercel Blob…</div>
                  )}
                </div>
              ) : (
                <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  {headerFormat === "IMAGE" && (
                    <img
                      src={headerMediaUrl}
                      alt="Header preview"
                      className="max-h-40 mx-auto rounded-md border border-slate-200"
                    />
                  )}
                  {headerFormat === "VIDEO" && (
                    <video
                      src={headerMediaUrl}
                      controls
                      className="max-h-40 mx-auto rounded-md border border-slate-200"
                    />
                  )}
                  {headerFormat === "DOCUMENT" && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <span>📄</span>
                      <a
                        href={headerMediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-wa-green hover:underline truncate"
                      >
                        {headerFilename ?? "View uploaded document"}
                      </a>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={clearMedia}
                    className="mt-2 text-xs text-red-600 hover:underline"
                  >
                    Remove and upload a different file
                  </button>
                </div>
              )}
            </Field>
          )}

          <Field label="Body" required>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="input min-h-[140px] font-mono text-sm"
              placeholder={"Hi {{1}}, your order {{2}} has shipped."}
              required
            />
          </Field>

          <Field label="Footer (optional)">
            <input
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              className="input"
              placeholder="Reply STOP to opt out"
            />
          </Field>
        </div>
        <div className="p-5 sm:p-6 border-t border-slate-200 flex flex-col sm:flex-row sm:justify-end gap-2 sticky bottom-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="order-2 sm:order-1 px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="order-1 sm:order-2 bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
        </div>
      </form>
      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          outline: none;
          font-size: 16px;
        }
        @media (min-width: 640px) {
          :global(.input) {
            font-size: 14px;
          }
        }
        :global(.input:focus) {
          border-color: #25d366;
          box-shadow: 0 0 0 3px rgba(37, 211, 102, 0.2);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

// Renders a small preview of the template's header on each card.
// header is JSON: { format, text? , url?, filename? } or null.
function TemplateHeaderPreview({ header }: { header: string | null }) {
  if (!header) return null;
  let h: any;
  try {
    h = JSON.parse(header);
  } catch {
    return null;
  }
  if (!h?.format) return null;

  if (h.format === "TEXT") {
    return <div className="text-xs font-semibold text-slate-900 mb-2 break-words">{h.text}</div>;
  }
  if (h.format === "IMAGE" && h.url) {
    return (
      <img
        src={h.url}
        alt="Template header"
        className="rounded-lg border border-slate-200 max-h-32 mb-3 object-cover"
      />
    );
  }
  if (h.format === "VIDEO" && h.url) {
    return (
      <video
        src={h.url}
        controls
        className="rounded-lg border border-slate-200 max-h-40 mb-3"
      />
    );
  }
  if (h.format === "DOCUMENT" && h.url) {
    return (
      <a
        href={h.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-wa-green hover:underline mb-2"
      >
        📄 {h.filename ?? "View document"}
      </a>
    );
  }
  return null;
}
