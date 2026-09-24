"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import ShareInsightModal from "@/app/(crm-app)/crm/insights/ShareInsightModal";

type DocRow = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  author: { name: string | null };
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function CampaignDocuments({ campaignMetaId }: { campaignMetaId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [sharing, setSharing] = useState<DocRow | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/ad-campaigns/${campaignMetaId}/documents`);
    if (res.ok) {
      const data = await res.json();
      setDocs(data.documents.map((d: DocRow & { createdAt: string | Date; updatedAt: string | Date }) => ({
        ...d,
        createdAt: typeof d.createdAt === "string" ? d.createdAt : new Date(d.createdAt).toISOString(),
        updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : new Date(d.updatedAt).toISOString(),
      })));
    }
    setLoading(false);
  }, [campaignMetaId]);

  useEffect(() => { load(); }, [load]);

  async function createDocument() {
    setCreating(true);
    try {
      const res = await fetch(`/api/ad-campaigns/${campaignMetaId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) { toast.error("Could not create document"); return; }
      const data = await res.json();
      router.push(`/ad-campaigns/${campaignMetaId}/documents/${data.document.id}`);
    } catch {
      toast.error("Could not create document");
    } finally {
      setCreating(false);
    }
  }

  async function deleteDocument(id: string) {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/insights/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Document deleted");
        load();
      } else {
        toast.error("Could not delete document");
      }
    } catch {
      toast.error("Could not delete document");
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-400 py-2">Loading documents...</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{docs.length} document{docs.length !== 1 ? "s" : ""}</span>
        <button
          onClick={createDocument}
          disabled={creating}
          className="text-xs font-medium text-court-600 hover:text-court-700 disabled:opacity-50"
        >
          {creating ? "Creating..." : "+ New Document"}
        </button>
      </div>

      {docs.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-slate-400 mb-2">No documents yet for this campaign</p>
          <button
            onClick={createDocument}
            disabled={creating}
            className="text-sm font-medium text-court-600 hover:text-court-700 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create first document"}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {docs.map((doc) => (
            <div key={doc.id} className="card p-3 hover:shadow-sm transition-shadow group">
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/ad-campaigns/${campaignMetaId}/documents/${doc.id}`}
                  className="flex-1 min-w-0"
                >
                  <div className="text-sm font-medium text-slate-900 truncate group-hover:text-court-600 transition-colors">
                    {doc.title}
                  </div>
                  <div className="flex gap-2 mt-0.5 text-[11px] text-slate-400">
                    <span>{doc.author?.name ?? "Unknown"}</span>
                    <span>·</span>
                    <span>{fmtDate(doc.updatedAt)}</span>
                  </div>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setSharing(doc)}
                    className="text-[11px] text-slate-500 font-medium hover:text-slate-700"
                  >
                    Share
                  </button>
                  <button
                    onClick={() => deleteDocument(doc.id)}
                    disabled={deleting === doc.id}
                    className="text-[11px] text-red-500 font-medium hover:text-red-700 disabled:opacity-50"
                  >
                    {deleting === doc.id ? "..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {sharing && (
        <ShareInsightModal
          docId={sharing.id}
          docTitle={sharing.title}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}
