"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/Toast";

type DocRow = { id: string; title: string; createdAt: string; updatedAt: string };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function InsightsListClient({ documents }: { documents: DocRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function createDocument() {
    setCreating(true);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) { toast.error("Could not create document"); return; }
      const data = await res.json();
      router.push(`/crm/insights/${data.document.id}`);
    } catch {
      toast.error("Could not create document");
    } finally {
      setCreating(false);
    }
  }

  async function deleteDocument(id: string) {
    if (!confirm("Delete this insight document? This cannot be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/insights/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Document deleted");
        router.refresh();
      } else {
        toast.error("Could not delete document");
      }
    } catch {
      toast.error("Could not delete document");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Insights</h1>
          <p className="text-sm text-slate-500 mt-0.5">Document your observations and insights from your work</p>
        </div>
        <button
          onClick={createDocument}
          disabled={creating}
          className="btn btn-primary !px-4 !py-2 !text-sm disabled:opacity-50"
        >
          {creating ? "Creating..." : "+ New Document"}
        </button>
      </div>

      {documents.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-3">📝</div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">No documents yet</h2>
          <p className="text-sm text-slate-500 mb-4">Create your first insight document to start capturing your observations</p>
          <button
            onClick={createDocument}
            disabled={creating}
            className="btn btn-primary !px-5 !py-2.5 !text-sm disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create first document"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="card p-4 hover:shadow-md transition-shadow group">
              <div className="flex items-center justify-between gap-4">
                <Link href={`/crm/insights/${doc.id}`} className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 truncate group-hover:text-court-600 transition-colors">
                    {doc.title}
                  </h3>
                  <div className="flex gap-3 mt-1 text-xs text-slate-400">
                    <span>Created {fmtDate(doc.createdAt)}</span>
                    <span>Updated {fmtDateTime(doc.updatedAt)}</span>
                  </div>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/crm/insights/${doc.id}`}
                    className="text-xs text-court-600 font-medium hover:text-court-700"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => deleteDocument(doc.id)}
                    disabled={deleting === doc.id}
                    className="text-xs text-red-500 font-medium hover:text-red-700 disabled:opacity-50"
                  >
                    {deleting === doc.id ? "..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
