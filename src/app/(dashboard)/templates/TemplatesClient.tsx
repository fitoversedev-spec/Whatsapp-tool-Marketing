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
  body: string;
  footer: string | null;
  status: string;
  rejectionReason: string | null;
  draftedByName: string;
  approvedByName: string | null;
  updatedAt: string;
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
  templates,
}: {
  currentUser: { role: "admin" | "sales" };
  templates: Template[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [showDraft, setShowDraft] = useState(false);
  const [filter, setFilter] = useState<string>("all");

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

  return (
    <>
      <PageHeader
        title="Templates"
        description="Message templates synced with Meta."
        action={
          <button
            onClick={() => setShowDraft(true)}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg transition w-full sm:w-auto"
          >
            + New template
          </button>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex gap-2 mb-4 sm:mb-6 overflow-x-auto pb-1 -mx-1 px-1">
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
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center text-slate-500">
            No templates. Click <strong>New template</strong> to create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            {filtered.map((t) => (
              <div key={t.id} className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{t.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {t.category} · {t.language}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 inline-block px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${
                      STATUS_COLORS[t.status] ?? "bg-slate-100"
                    }`}
                  >
                    {t.status.replace("_", " ")}
                  </span>
                </div>
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
                    {t.status === "draft" && (
                      <button
                        onClick={() => act(t.id, "submit_for_review")}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 rounded text-slate-700 font-medium"
                      >
                        Submit for review
                      </button>
                    )}
                    {t.status === "pending_admin" && currentUser.role === "admin" && (
                      <button
                        onClick={() => act(t.id, "submit_to_meta")}
                        className="px-3 py-1.5 bg-wa-green hover:bg-wa-green/90 active:bg-wa-green/80 text-white rounded font-medium"
                      >
                        Submit to Meta
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, language, category, body, footer: footer || null }),
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
