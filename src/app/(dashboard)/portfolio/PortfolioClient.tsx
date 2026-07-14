"use client";

// Portfolio admin page. List of past Fitoverse builds across sports.
// Admin can add / edit / delete + toggle featured (catalogue inclusion).
// Sales sees the list (read-only) and can launch the Send Catalogue
// flow from the inbox header instead of editing here.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import PortfolioProjectModal from "./PortfolioProjectModal";
import CatalogueUploadsPanel, { type CatalogueRow } from "./CatalogueUploadsPanel";

export type PortfolioRow = {
  id: string;
  customerName: string;
  location: string | null;
  sport: string;
  completionDate: string | null;
  plotLengthFt: number | null;
  plotWidthFt: number | null;
  surfaceType: string | null;
  surfaceGrade: string | null;
  shortDescription: string | null;
  photos: { url: string; caption?: string }[];
  heroPhotoUrl: string | null;
  videoUrl: string | null;
  tags: string;
  featured: boolean;
  createdByName: string;
  createdAt: string;
};

const SPORT_OPTIONS = [
  "football",
  "cricket",
  "basketball",
  "pickleball",
  "tennis",
  "badminton",
  "volleyball",
  "multisport",
] as const;

export default function PortfolioClient({
  isAdmin,
  initialProjects,
  initialCatalogues,
}: {
  isAdmin: boolean;
  initialProjects: PortfolioRow[];
  initialCatalogues: CatalogueRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<PortfolioRow[]>(initialProjects);
  const [editing, setEditing] = useState<PortfolioRow | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [featuredOnly, setFeaturedOnly] = useState(false);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (sportFilter !== "all" && r.sport !== sportFilter) return false;
      if (featuredOnly && !r.featured) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (
          !r.customerName.toLowerCase().includes(s) &&
          !(r.location ?? "").toLowerCase().includes(s) &&
          !(r.tags ?? "").toLowerCase().includes(s)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [rows, search, sportFilter, featuredOnly]);

  async function reload() {
    const res = await fetch("/api/portfolio");
    if (!res.ok) return;
    const data = await res.json();
    setRows(
      (data.projects ?? []).map(
        (p: PortfolioRow & { archived?: boolean; updatedAt?: string }) => p
      )
    );
  }

  async function toggleFeatured(p: PortfolioRow) {
    if (!isAdmin) return;
    const res = await fetch(`/api/portfolio/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured: !p.featured }),
    });
    if (!res.ok) {
      toast.error("Could not update featured flag");
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.id === p.id ? { ...r, featured: !r.featured } : r))
    );
    toast.success(p.featured ? "Removed from catalogue" : "Added to catalogue");
  }

  async function archiveProject(id: string) {
    if (!confirm("Hide this project from the catalogue + listings?")) return;
    const res = await fetch(`/api/portfolio/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    if (!res.ok) {
      toast.error("Could not archive");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success("Archived");
  }

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Past Fitoverse builds. Featured projects show up in the per-sport catalogue PDF that sales sends to customers."
        action={
          isAdmin ? (
            <button
              onClick={() => {
                setEditing(null);
                setShowModal(true);
              }}
              className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm"
            >
              + Add project
            </button>
          ) : null
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        <CatalogueUploadsPanel isAdmin={isAdmin} initialCatalogues={initialCatalogues} />

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, location, tags…"
            className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
          />
          <select
            value={sportFilter}
            onChange={(e) => setSportFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white capitalize"
          >
            <option value="all">All sports</option>
            {SPORT_OPTIONS.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-700 px-2">
            <input
              type="checkbox"
              checked={featuredOnly}
              onChange={(e) => setFeaturedOnly(e.target.checked)}
              className="accent-wa-green"
            />
            Featured only
          </label>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <div className="text-4xl mb-3">📂</div>
            <div className="text-sm font-semibold text-slate-900 mb-1">
              {rows.length === 0 ? "No portfolio projects yet" : "No matches"}
            </div>
            <div className="text-xs text-slate-500 mb-4">
              {rows.length === 0
                ? "Add past Fitoverse builds so sales can send sport-specific catalogues to customers."
                : "Try a different filter."}
            </div>
            {isAdmin && rows.length === 0 && (
              <button
                onClick={() => {
                  setEditing(null);
                  setShowModal(true);
                }}
                className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm"
              >
                + Add your first project
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-slate-300 transition group"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!isAdmin) return;
                    setEditing(p);
                    setShowModal(true);
                  }}
                  className="block w-full aspect-video bg-slate-100 overflow-hidden relative"
                >
                  {p.heroPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.heroPhotoUrl}
                      alt={p.customerName}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                      No photo
                    </div>
                  )}
                  {p.featured && (
                    <div className="absolute top-2 right-2 bg-amber-400 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded">
                      ★ FEATURED
                    </div>
                  )}
                </button>
                <div className="p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded capitalize">
                      {p.sport}
                    </span>
                    {p.surfaceGrade && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
                        {p.surfaceGrade}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-slate-900 leading-tight line-clamp-1">
                    {p.customerName}
                  </div>
                  {p.location && (
                    <div className="text-[11px] text-slate-500 line-clamp-1">
                      📍 {p.location}
                    </div>
                  )}
                  {(p.plotLengthFt || p.plotWidthFt) && (
                    <div className="text-[11px] text-slate-500">
                      {p.plotLengthFt} × {p.plotWidthFt} ft
                    </div>
                  )}
                  {isAdmin && (
                    <div className="flex items-center gap-1 pt-1.5">
                      <button
                        type="button"
                        onClick={() => toggleFeatured(p)}
                        className={`flex-1 text-[10px] py-1 rounded border ${
                          p.featured
                            ? "border-amber-400 bg-amber-50 text-amber-800"
                            : "border-slate-300 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {p.featured ? "★ Featured" : "☆ Add to catalogue"}
                      </button>
                      <button
                        type="button"
                        onClick={() => archiveProject(p.id)}
                        className="text-[10px] text-slate-500 hover:text-red-600 hover:bg-red-50 rounded px-2 py-1"
                        title="Archive"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <PortfolioProjectModal
        open={showModal}
        onClose={() => setShowModal(false)}
        editing={editing}
        onSaved={() => {
          setShowModal(false);
          reload();
          router.refresh();
        }}
      />
    </>
  );
}
