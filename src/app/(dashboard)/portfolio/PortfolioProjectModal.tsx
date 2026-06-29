"use client";

// Add / edit a portfolio project. Photo upload goes through the
// existing /api/media/upload endpoint so files land in Vercel Blob
// alongside quotation PDFs + court-image PNGs.
//
// The form is intentionally flat — long single column on mobile, two
// columns on desktop — so sales can fill it out quickly. Photos panel
// supports multiple photos + a hero pick (the one that goes into the
// catalogue PDF cover for that project).

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import type { PortfolioRow } from "./PortfolioClient";

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

type Photo = { url: string; caption?: string };

export default function PortfolioProjectModal({
  open,
  onClose,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: PortfolioRow | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [location, setLocation] = useState("");
  const [sport, setSport] = useState<string>("football");
  const [completionDate, setCompletionDate] = useState("");
  const [plotLengthFt, setPlotLengthFt] = useState<number | "">("");
  const [plotWidthFt, setPlotWidthFt] = useState<number | "">("");
  const [surfaceType, setSurfaceType] = useState("");
  const [surfaceGrade, setSurfaceGrade] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [tags, setTags] = useState("");
  const [featured, setFeatured] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [heroPhotoUrl, setHeroPhotoUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setCustomerName(editing.customerName);
      setLocation(editing.location ?? "");
      setSport(editing.sport);
      setCompletionDate(editing.completionDate?.slice(0, 10) ?? "");
      setPlotLengthFt(editing.plotLengthFt ?? "");
      setPlotWidthFt(editing.plotWidthFt ?? "");
      setSurfaceType(editing.surfaceType ?? "");
      setSurfaceGrade(editing.surfaceGrade ?? "");
      setShortDescription(editing.shortDescription ?? "");
      setTags(editing.tags ?? "");
      setFeatured(editing.featured);
      setPhotos(editing.photos);
      setHeroPhotoUrl(editing.heroPhotoUrl);
      setVideoUrl(editing.videoUrl ?? "");
    } else {
      setCustomerName("");
      setLocation("");
      setSport("football");
      setCompletionDate("");
      setPlotLengthFt("");
      setPlotWidthFt("");
      setSurfaceType("");
      setSurfaceGrade("");
      setShortDescription("");
      setTags("");
      setFeatured(false);
      setPhotos([]);
      setHeroPhotoUrl(null);
      setVideoUrl("");
    }
  }, [open, editing]);

  async function uploadPhoto(file: File) {
    setUploadingPhoto(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: form });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "Upload failed");
      }
      const data = await res.json();
      const url = data.media.url as string;
      setPhotos((prev) => [...prev, { url }]);
      // First photo automatically becomes the hero.
      if (!heroPhotoUrl) setHeroPhotoUrl(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function submit() {
    if (!customerName.trim() || !sport) {
      toast.error("Customer name + sport are required");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        customerName: customerName.trim(),
        location: location.trim() || null,
        sport,
        completionDate: completionDate
          ? new Date(completionDate + "T12:00:00").toISOString()
          : null,
        plotLengthFt: plotLengthFt === "" ? null : Number(plotLengthFt),
        plotWidthFt: plotWidthFt === "" ? null : Number(plotWidthFt),
        surfaceType: surfaceType.trim() || null,
        surfaceGrade: surfaceGrade.trim() || null,
        shortDescription: shortDescription.trim() || null,
        photos,
        heroPhotoUrl,
        videoUrl: videoUrl.trim() || null,
        tags: tags.trim() || "",
        featured,
      };
      const url = editing ? `/api/portfolio/${editing.id}` : "/api/portfolio";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? e.message ?? "Save failed");
      }
      toast.success(editing ? "Updated" : "Project added");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-stretch justify-center p-2 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-900">
              {editing ? "Edit project" : "Add portfolio project"}
            </div>
            {editing && (
              <div className="text-xs text-slate-500">
                Added by {editing.createdByName}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-100"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Basics */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer / site name *">
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={inputClass}
                placeholder="Sky Sports Arena"
              />
            </Field>
            <Field label="Location">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={inputClass}
                placeholder="Coimbatore, Tamil Nadu"
              />
            </Field>
            <Field label="Sport *">
              <select
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                className={inputClass + " bg-white capitalize"}
              >
                {SPORT_OPTIONS.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Completion date">
              <input
                type="date"
                value={completionDate}
                onChange={(e) => setCompletionDate(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Plot length (ft)">
              <input
                type="number"
                value={plotLengthFt}
                onChange={(e) =>
                  setPlotLengthFt(e.target.value === "" ? "" : Number(e.target.value))
                }
                className={inputClass}
              />
            </Field>
            <Field label="Plot width (ft)">
              <input
                type="number"
                value={plotWidthFt}
                onChange={(e) =>
                  setPlotWidthFt(e.target.value === "" ? "" : Number(e.target.value))
                }
                className={inputClass}
              />
            </Field>
            <Field label="Surface type">
              <input
                value={surfaceType}
                onChange={(e) => setSurfaceType(e.target.value)}
                className={inputClass}
                placeholder="50mm 3rd-gen turf"
              />
            </Field>
            <Field label="Surface grade / tier">
              <input
                value={surfaceGrade}
                onChange={(e) => setSurfaceGrade(e.target.value)}
                className={inputClass}
                placeholder="Standard / Premium"
              />
            </Field>
          </section>

          <Field label="Short description (catalogue)">
            <textarea
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              rows={3}
              className={inputClass + " resize-none"}
              placeholder="One-paragraph summary that goes into the catalogue PDF beside the photo."
            />
          </Field>

          <Field label="Tags (comma-separated)">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className={inputClass}
              placeholder="commercial, box-turf, FIFA-grade"
            />
          </Field>

          <Field label="Video URL (optional)">
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className={inputClass}
              placeholder="https://… (showcase clip)"
            />
          </Field>

          {/* Photos */}
          <section className="border-t border-slate-200 pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Photos</div>
                <div className="text-[11px] text-slate-500">
                  First-uploaded photo becomes the catalogue hero by default.
                </div>
              </div>
              <label className="text-xs font-medium bg-wa-green hover:bg-wa-green/90 text-white px-3 py-1.5 rounded-md cursor-pointer">
                {uploadingPhoto ? "Uploading…" : "+ Add photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadPhoto(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {photos.length === 0 ? (
              <div className="text-xs text-slate-500 italic py-3 text-center bg-slate-50 rounded-md">
                No photos yet
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {photos.map((p, i) => (
                  <div
                    key={p.url}
                    className={`relative aspect-square rounded-md overflow-hidden border-2 ${
                      heroPhotoUrl === p.url ? "border-wa-green" : "border-slate-200"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setHeroPhotoUrl(p.url)}
                      className={`absolute top-1 left-1 text-[9px] px-1.5 py-0.5 rounded ${
                        heroPhotoUrl === p.url
                          ? "bg-wa-green text-white"
                          : "bg-white/90 text-slate-700"
                      }`}
                    >
                      {heroPhotoUrl === p.url ? "★ Hero" : "☆ Hero"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPhotos((prev) => prev.filter((_, j) => j !== i));
                        if (heroPhotoUrl === p.url) {
                          // Promote next photo if any
                          const remaining = photos.filter((_, j) => j !== i);
                          setHeroPhotoUrl(remaining[0]?.url ?? null);
                        }
                      }}
                      className="absolute top-1 right-1 text-[9px] bg-white/90 text-red-600 rounded px-1.5 py-0.5"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <label className="flex items-start gap-2 border-t border-slate-200 pt-4 cursor-pointer">
            <input
              type="checkbox"
              checked={featured}
              onChange={(e) => setFeatured(e.target.checked)}
              className="mt-1 accent-amber-500"
            />
            <div>
              <div className="text-sm font-medium text-slate-900">
                ★ Featured — show in the {sport} catalogue PDF
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Up to 6 featured projects per sport appear in the catalogue. Use this
                to curate your best builds.
              </div>
            </div>
          </label>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {submitting ? "Saving…" : editing ? "Save changes" : "Add project"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-500 uppercase tracking-wide">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30";
