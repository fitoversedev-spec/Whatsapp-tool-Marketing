"use client";

// Products management — the internal catalogue that replaces MVPv2.
// Three sidebar sections:
//   1. Products   — floorings + materials (photo / video / description)
//   2. Equipment  — sports equipment per sport (goal post, net, machine…)
//   3. TDS        — technical data sheet PDFs per sport
// The court designer + chatbot read from these.

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import type { ProductDTO, ProductType } from "@/lib/products/store";
import { toEmbeddableImage } from "@/lib/products/image-embed";

const SPORTS = [
  "football",
  "cricket",
  "basketball",
  "pickleball",
  "tennis",
  "badminton",
  "volleyball",
  "multisport",
] as const;

const SPORT_LABEL: Record<string, string> = {
  football: "Football",
  cricket: "Cricket",
  basketball: "Basketball",
  pickleball: "Pickleball",
  tennis: "Tennis",
  badminton: "Badminton",
  volleyball: "Volleyball",
  multisport: "Multisport",
};

type Section = "products" | "equipment" | "tds";

export default function ProductsClient({
  initialProducts,
}: {
  initialProducts: ProductDTO[];
}) {
  const [section, setSection] = useState<Section>("products");
  const [products, setProducts] = useState<ProductDTO[]>(initialProducts);
  const [sportFilter, setSportFilter] = useState<string>("all");

  async function reload() {
    const r = await fetch("/api/products");
    if (!r.ok) return;
    const j = await r.json();
    setProducts(j.products ?? []);
  }

  const nav: Array<{ id: Section; label: string; icon: string; hint: string }> = [
    { id: "products", label: "Products", icon: "🟩", hint: "Floorings & materials" },
    { id: "equipment", label: "Sports equipment", icon: "🥅", hint: "Goal posts, nets…" },
    { id: "tds", label: "TDS sheets", icon: "📄", hint: "PDF per sport" },
  ];

  return (
    <>
      <PageHeader
        title="Products"
        description="Fitoverse's own catalogue — floorings, materials, equipment, and TDS sheets. The Court Designer and chatbot read from here."
      />
      <div className="flex flex-col lg:flex-row gap-4 p-4 sm:p-6 lg:p-8">
        {/* Sidebar sections */}
        <nav className="lg:w-56 shrink-0 flex lg:flex-col gap-2">
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSection(n.id)}
              className={`flex-1 lg:flex-none flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition ${
                section === n.id
                  ? "bg-wa-green/10 border-wa-green text-wa-dark"
                  : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              <span className="text-lg">{n.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">
                  {n.label}
                </span>
                <span className="block text-[11px] text-slate-500 truncate">
                  {n.hint}
                </span>
              </span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Sport filter — shared across sections */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mr-1">
              Sport
            </span>
            <FilterChip
              active={sportFilter === "all"}
              onClick={() => setSportFilter("all")}
            >
              All
            </FilterChip>
            {SPORTS.map((s) => (
              <FilterChip
                key={s}
                active={sportFilter === s}
                onClick={() => setSportFilter(s)}
              >
                {SPORT_LABEL[s]}
              </FilterChip>
            ))}
          </div>

          {section === "products" && (
            <ProductSection
              kindLabel="Product"
              types={["flooring", "material"]}
              defaultType="flooring"
              products={products.filter(
                (p) => p.type === "flooring" || p.type === "material",
              )}
              sportFilter={sportFilter}
              onChanged={reload}
            />
          )}
          {section === "equipment" && (
            <ProductSection
              kindLabel="Equipment"
              types={["equipment"]}
              defaultType="equipment"
              products={products.filter((p) => p.type === "equipment")}
              sportFilter={sportFilter}
              onChanged={reload}
            />
          )}
          {section === "tds" && (
            <TdsSection
              sportFilter={sportFilter === "all" ? "football" : sportFilter}
              products={products}
            />
          )}
        </div>
      </div>
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-full border transition ${
        active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Product / Equipment section ────────────────────────────────────────

function ProductSection({
  kindLabel,
  types,
  defaultType,
  products,
  sportFilter,
  onChanged,
}: {
  kindLabel: string;
  types: ProductType[];
  defaultType: ProductType;
  products: ProductDTO[];
  sportFilter: string;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const filtered = useMemo(
    () =>
      sportFilter === "all"
        ? products
        : products.filter((p) => p.sports.includes(sportFilter)),
    [products, sportFilter],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">
          {kindLabel}s{" "}
          <span className="text-sm font-normal text-slate-500">
            ({filtered.length})
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="bg-wa-green hover:bg-wa-green/90 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          {adding ? "Cancel" : `+ Add ${kindLabel.toLowerCase()}`}
        </button>
      </div>

      {adding && (
        <ProductForm
          types={types}
          defaultType={defaultType}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          No {kindLabel.toLowerCase()}s yet{sportFilter !== "all" ? ` for ${SPORT_LABEL[sportFilter]}` : ""}.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  onChanged,
}: {
  product: ProductDTO;
  onChanged: () => void;
}) {
  const toast = useToast();
  async function archive() {
    if (!confirm(`Remove "${product.name}" from the catalogue?`)) return;
    const r = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Removed");
      onChanged();
    } else {
      toast.error("Remove failed");
    }
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="aspect-video bg-slate-100">
        {product.heroImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.heroImageUrl}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
            No photo
          </div>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold text-slate-900 leading-tight">
            {product.name}
          </div>
          <button
            type="button"
            onClick={archive}
            className="text-xs text-red-500 hover:underline shrink-0"
          >
            Remove
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded capitalize">
            {product.type}
          </span>
          {product.sports.map((s) => (
            <span
              key={s}
              className="text-[10px] px-1.5 py-0.5 bg-wa-green/10 text-wa-dark rounded"
            >
              {SPORT_LABEL[s] ?? s}
            </span>
          ))}
        </div>
        {product.description && (
          <p className="text-[11px] text-slate-500 line-clamp-2">
            {stripHtml(product.description)}
          </p>
        )}
        {product.priceInr != null && (
          <div className="text-xs text-slate-700">
            ₹{product.priceInr.toLocaleString("en-IN")}
            {product.unit ? ` / ${product.unit}` : ""}
          </div>
        )}
        {product.videoUrl && (
          <a
            href={product.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-wa-dark hover:underline block"
          >
            ▶ Video
          </a>
        )}
      </div>
    </div>
  );
}

function ProductForm({
  types,
  defaultType,
  onDone,
}: {
  types: ProductType[];
  defaultType: ProductType;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ProductType>(defaultType);
  const [description, setDescription] = useState("");
  const [sports, setSports] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [priceInr, setPriceInr] = useState("");
  const [unit, setUnit] = useState("");
  const [hero, setHero] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);

  function toggleSport(s: string) {
    setSports((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (sports.length === 0) {
      toast.error("Pick at least one sport");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("name", name.trim());
    form.set("type", type);
    form.set("description", description);
    form.set("sports", JSON.stringify(sports));
    form.set("category", category);
    form.set("priceInr", priceInr);
    form.set("unit", unit);
    if (hero) form.set("hero", await toEmbeddableImage(hero));
    if (video) form.set("video", video);
    const r = await fetch("/api/products", { method: "POST", body: form });
    setBusy(false);
    if (r.ok) {
      toast.success("Added");
      onDone();
    } else {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "Save failed");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Football Turf 50mm FIFA"
            className="input mt-1"
          />
        </label>
        {types.length > 1 ? (
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              Type
            </span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ProductType)}
              className="input mt-1"
            >
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              Category
            </span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. goal, net, machine"
              className="input mt-1"
            />
          </label>
        )}
      </div>

      <label className="block">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
          Description
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Specs, dimensions, key features…"
          className="input mt-1"
        />
      </label>

      <div>
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
          Sports (pick one or more)
        </span>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {SPORTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleSport(s)}
              className={`px-2.5 py-1 text-xs rounded-full border transition ${
                sports.includes(s)
                  ? "bg-wa-green text-white border-wa-green"
                  : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
              }`}
            >
              {SPORT_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
            Price ₹ (optional)
          </span>
          <input
            type="number"
            value={priceInr}
            onChange={(e) => setPriceInr(e.target.value)}
            placeholder="e.g. 112"
            className="input mt-1"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
            Unit (optional)
          </span>
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="sqft · piece · roll"
            className="input mt-1"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="block min-w-0">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
            Photo
          </span>
          <FilePicker
            accept="image/*"
            file={hero}
            onPick={setHero}
            label="Choose photo"
            className="mt-1 w-full"
          />
        </div>
        <div className="block min-w-0">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
            Video (optional)
          </span>
          <FilePicker
            accept="video/*"
            file={video}
            onPick={setVideo}
            label="Choose video"
            className="mt-1 w-full"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="bg-wa-green hover:bg-wa-green/90 text-white text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save product"}
        </button>
      </div>
    </form>
  );
}

// Styled, width-controlled file picker. The native <input type="file"> has
// an uncontrollable intrinsic width (its "Choose File" button + filename),
// which pushed rows past the screen edge. This wraps a hidden input in a
// label that truncates the filename, so it never overflows its column.
function FilePicker({
  accept,
  file,
  onPick,
  label,
  className = "",
}: {
  accept: string;
  file: File | null;
  onPick: (f: File | null) => void;
  label: string;
  className?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 min-w-0 cursor-pointer text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white hover:border-slate-400 ${className}`}
    >
      <input
        type="file"
        accept={accept}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      <span className="shrink-0 font-medium text-slate-700">{label}</span>
      <span className="truncate text-slate-500">
        {file ? file.name : "No file chosen"}
      </span>
    </label>
  );
}

// ─── TDS section ────────────────────────────────────────────────────────

function TdsSection({
  sportFilter,
  products,
}: {
  sportFilter: string;
  products: ProductDTO[];
}) {
  const toast = useToast();
  const [sport, setSport] = useState<string>(sportFilter);
  const [files, setFiles] = useState<
    Array<{ id: string; name: string; url: string }>
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(forSport: string) {
    setLoaded(false);
    const r = await fetch(`/api/products/tds?sport=${forSport}`);
    const j = await r.json().catch(() => ({ files: [] }));
    setFiles(j.files ?? []);
    setLoaded(true);
  }

  // Load on first render + when the sport filter changes.
  useEffect(() => {
    setSport(sportFilter);
    load(sportFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportFilter]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !file) {
      toast.error("Name + PDF required");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("sport", sport);
    form.set("name", name.trim());
    if (productId) form.set("productId", productId);
    form.set("file", file);
    const r = await fetch("/api/products/tds", { method: "POST", body: form });
    setBusy(false);
    if (r.ok) {
      toast.success("Uploaded");
      setName("");
      setFile(null);
      setProductId("");
      load(sport);
    } else {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "Upload failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this TDS?")) return;
    const r = await fetch(`/api/products/tds?id=${id}`, { method: "DELETE" });
    if (r.ok) load(sport);
    else toast.error("Remove failed");
  }

  const sportProducts = products.filter((p) => p.sports.includes(sport));

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">
        TDS sheets — {SPORT_LABEL[sport] ?? sport}
      </h2>
      <div className="text-xs text-slate-500">
        Uploaded here, TDS sheets appear in the Court Designer&apos;s TDS tab
        and can be attached to the combined PDF.
      </div>

      <form
        onSubmit={upload}
        className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name (e.g. Turf 50mm — TDS)"
          className="input flex-1 min-w-0 sm:min-w-[9rem]"
        />
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="input flex-1 min-w-0 sm:min-w-[9rem]"
        >
          <option value="">Sport-level (no specific product)</option>
          {sportProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <FilePicker
          accept="application/pdf,.pdf"
          file={file}
          onPick={(f) => {
            setFile(f);
            // Auto-fill the display name from the PDF filename when it's
            // still empty, so the Upload button enables right after
            // choosing a file (name stays editable).
            if (f && !name.trim()) {
              setName(f.name.replace(/\.pdf$/i, "").trim());
            }
          }}
          label="Choose PDF"
          className="flex-1 min-w-0 sm:min-w-[9rem]"
        />
        <button
          type="submit"
          disabled={busy || !name.trim() || !file}
          className="bg-wa-green hover:bg-wa-green/90 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          Upload
        </button>
      </form>

      {!loaded ? (
        <div className="text-xs text-slate-500 italic">Loading…</div>
      ) : files.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-500">
          No TDS files for {SPORT_LABEL[sport] ?? sport} yet.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 bg-white border border-slate-200 rounded-md px-3 py-2 text-sm"
            >
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-wa-dark hover:underline truncate"
              >
                📄 {f.name}
              </a>
              <button
                type="button"
                onClick={() => remove(f.id)}
                className="text-xs text-red-500 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
