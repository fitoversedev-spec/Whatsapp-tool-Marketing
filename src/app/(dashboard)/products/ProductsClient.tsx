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
import { extractHtmlTables } from "@/lib/products/format";

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

// Keep in sync with SPEC_CARD_MAX in QuoteWizard.tsx / combined-pdf route.ts —
// the quote spec card renders at most this many rows per product.
const SPEC_CARD_MAX = 12;

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
  ];

  return (
    <>
      <PageHeader
        title="Products"
        description="Fitoverse's own catalogue — floorings, materials and equipment. Each item carries its own TDS (add it in the product form). The Court Designer and chatbot read from here."
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
            <ProductCard
              key={p.id}
              product={p}
              types={types}
              defaultType={defaultType}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  types,
  defaultType,
  onChanged,
}: {
  product: ProductDTO;
  types: ProductType[];
  defaultType: ProductType;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
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

  // Inline edit — reuse the product form pre-filled, spanning the full grid
  // width so the fields aren't cramped into a single column.
  if (editing) {
    return (
      <div className="sm:col-span-2 xl:col-span-3">
        <ProductForm
          types={types}
          defaultType={defaultType}
          product={product}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
        />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-1 text-xs text-slate-500 hover:underline"
        >
          Cancel edit
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="aspect-video bg-slate-100">
        {product.heroImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.heroImageUrl}
            alt={product.name}
            loading="lazy"
            decoding="async"
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
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-wa-dark hover:underline"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={archive}
              className="text-xs text-red-500 hover:underline"
            >
              Remove
            </button>
          </div>
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

// Shared field styling. The page has no global `.input` rule (that class is
// only defined inside other pages' styled-jsx), so fields must carry their
// own border/padding/focus styles or they render as bare unstyled text.
const FIELD =
  "w-full mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm " +
  "text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 " +
  "focus:ring-wa-green/30 focus:border-wa-green transition";
const FIELD_LABEL =
  "text-[11px] font-semibold text-slate-500 uppercase tracking-wide";
const SECTION_BOX = "rounded-xl border border-slate-200 bg-slate-50/40 p-4";
const SECTION_TITLE =
  "text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3";

function ProductForm({
  types,
  defaultType,
  product,
  onDone,
}: {
  types: ProductType[];
  defaultType: ProductType;
  product?: ProductDTO;
  onDone: () => void;
}) {
  const toast = useToast();
  const editing = !!product;
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(product?.name ?? "");
  const [type, setType] = useState<ProductType>(product?.type ?? defaultType);
  const [description, setDescription] = useState(product?.description ?? "");
  const [sports, setSports] = useState<string[]>(
    product ? [...product.sports] : [],
  );
  const [category, setCategory] = useState(product?.category ?? "");
  const [priceInr, setPriceInr] = useState(
    product?.priceInr != null ? String(product.priceInr) : "",
  );
  const [unit, setUnit] = useState(product?.unit ?? "");
  const [hero, setHero] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [tdsFile, setTdsFile] = useState<File | null>(null);
  const [existingTds, setExistingTds] = useState(product?.tdsFiles ?? []);
  // Structured specs (Label + Value rows) → rendered as the product's spec
  // card on quotations. Seeded from the product's existing specs; can be
  // pulled from the description's spec tables with one click.
  const [specs, setSpecs] = useState<Array<{ key: string; value: string }>>(
    product?.specs && Object.keys(product.specs).length
      ? Object.entries(product.specs).map(([k, v]) => ({ key: k, value: String(v) }))
      : [],
  );

  function addSpecRow() {
    setSpecs((prev) => [...prev, { key: "", value: "" }]);
  }
  function updateSpecRow(i: number, field: "key" | "value", val: string) {
    setSpecs((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
  }
  function removeSpecRow(i: number) {
    setSpecs((prev) => prev.filter((_, idx) => idx !== i));
  }
  // Parse the description's spec tables (Product Information / Yarn / Backing…)
  // into Label+Value rows so existing products don't need retyping. Appends any
  // labels not already present; keeps whatever the user already entered.
  function pullSpecsFromDescription() {
    const { tables } = extractHtmlTables(description);
    const pulled: Array<{ key: string; value: string }> = [];
    for (const t of tables) {
      for (const [k, v] of t.rows) {
        const key = (k ?? "").trim();
        const value = (v ?? "").trim();
        if (key && value) pulled.push({ key, value });
      }
    }
    if (pulled.length === 0) {
      toast.error("No spec tables found in the description");
      return;
    }
    setSpecs((prev) => {
      const seen = new Set(
        prev.filter((r) => r.key.trim()).map((r) => r.key.trim().toLowerCase()),
      );
      const merged = prev.filter((r) => r.key.trim() || r.value.trim());
      for (const r of pulled) {
        const lk = r.key.toLowerCase();
        if (!seen.has(lk)) {
          merged.push(r);
          seen.add(lk);
        }
      }
      return merged;
    });
    toast.success(`Pulled ${pulled.length} spec rows from the description`);
  }

  function toggleSport(s: string) {
    setSports((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  async function removeTdsFile(id: string) {
    const r = await fetch(`/api/products/tds?id=${id}`, { method: "DELETE" });
    if (r.ok) setExistingTds((prev) => prev.filter((t) => t.id !== id));
    else toast.error("Couldn't remove TDS");
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
    // Build the specs map from the Label+Value rows (drop rows with no label).
    const specsObj: Record<string, string> = {};
    for (const { key, value } of specs) {
      const k = key.trim();
      if (k) specsObj[k] = value.trim();
    }
    form.set("specs", JSON.stringify(specsObj));
    if (hero) form.set("hero", await toEmbeddableImage(hero));
    if (video) form.set("video", video);
    const r = editing
      ? await fetch(`/api/products/${product!.id}`, { method: "PATCH", body: form })
      : await fetch("/api/products", { method: "POST", body: form });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      toast.error(j.error ?? "Save failed");
      return;
    }
    // Upload the TDS sheet (if chosen), linked to this product, so it travels
    // with the product into the combined PDF.
    const saved = await r.json().catch(() => ({}));
    const productId: string | undefined = editing
      ? product!.id
      : saved.product?.id;
    if (tdsFile && productId) {
      const tf = new FormData();
      tf.set("sport", sports[0] ?? "football");
      tf.set(
        "name",
        tdsFile.name.replace(/\.pdf$/i, "").trim() || `${name.trim()} — TDS`,
      );
      tf.set("productId", productId);
      tf.set("file", tdsFile);
      const tr = await fetch("/api/products/tds", { method: "POST", body: tf });
      if (!tr.ok) toast.error("Product saved, but the TDS upload failed");
    }
    setBusy(false);
    toast.success(editing ? "Updated" : "Added");
    onDone();
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5 shadow-sm"
    >
      <h3 className="text-base font-semibold text-slate-900">
        {editing ? "Edit product" : "New product"}
      </h3>

      {/* Basic info */}
      <section className={SECTION_BOX}>
        <div className={SECTION_TITLE}>Basic info</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={FIELD_LABEL}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Football Turf 50mm FIFA"
              className={FIELD}
            />
          </label>
          {types.length > 1 ? (
            <label className="block">
              <span className={FIELD_LABEL}>Type</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ProductType)}
                className={FIELD}
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
              <span className={FIELD_LABEL}>Category</span>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. goal, net, machine"
                className={FIELD}
              />
            </label>
          )}
        </div>

        <label className="block mt-4">
          <span className={FIELD_LABEL}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={12}
            placeholder="Specs, dimensions, key features… (catalogue HTML tables are kept as-is)"
            className={`${FIELD} font-mono text-xs leading-relaxed resize-y min-h-[14rem]`}
          />
        </label>
      </section>

      {/* Specifications — the quote spec card */}
      <section className={SECTION_BOX}>
        <div className="flex items-center justify-between gap-3">
          <div className={SECTION_TITLE}>Specifications — shown as the spec card on quotes</div>
          <button
            type="button"
            onClick={pullSpecsFromDescription}
            className="shrink-0 text-[11px] font-medium text-wa-dark border border-slate-300 rounded-md px-2.5 py-1 hover:border-wa-green hover:bg-wa-green/5"
            title="Fill these rows from the description's spec tables"
          >
            ↧ Pull from description
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-1 mb-2">
          Label + value rows (e.g. Pile Height / 30 mm). These render as this
          product&apos;s spec card after the quotation table. Leave empty and the
          quote falls back to the description&apos;s spec tables automatically.
        </p>
        <div className="space-y-2">
          {specs.length === 0 ? (
            <div className="text-xs text-slate-400 italic">
              No specs yet — add rows, or pull them from the description above.
            </div>
          ) : (
            specs.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={row.key}
                  onChange={(e) => updateSpecRow(i, "key", e.target.value)}
                  placeholder="Label (e.g. Pile Height)"
                  className={`${FIELD} flex-1 min-w-0`}
                />
                <input
                  value={row.value}
                  onChange={(e) => updateSpecRow(i, "value", e.target.value)}
                  placeholder="Value (e.g. 30 mm)"
                  className={`${FIELD} flex-1 min-w-0`}
                />
                <button
                  type="button"
                  onClick={() => removeSpecRow(i)}
                  className="shrink-0 text-slate-400 hover:text-red-500 text-sm px-1"
                  title="Remove row"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={addSpecRow}
          className="mt-2 text-[11px] text-wa-dark border border-dashed border-wa-green/40 rounded-md px-3 py-1 hover:bg-wa-green/5"
        >
          + Add spec row
        </button>
        {specs.length > SPEC_CARD_MAX && (
          <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
            ⚠ Only the first {SPEC_CARD_MAX} specs will appear on the quote spec
            card — trim the list for a cleaner PDF (the rest stay saved here).
          </p>
        )}
      </section>

      {/* Sports */}
      <section className={SECTION_BOX}>
        <div className={SECTION_TITLE}>Sports (pick one or more)</div>
        <div className="flex flex-wrap gap-1.5">
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
      </section>

      {/* Pricing */}
      <section className={SECTION_BOX}>
        <div className={SECTION_TITLE}>Pricing</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={FIELD_LABEL}>Price ₹ (optional)</span>
            <input
              type="number"
              value={priceInr}
              onChange={(e) => setPriceInr(e.target.value)}
              placeholder="e.g. 112"
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className={FIELD_LABEL}>Unit (optional)</span>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="sqft · piece · roll"
              className={FIELD}
            />
          </label>
        </div>
      </section>

      {/* Media */}
      <section className={SECTION_BOX}>
        <div className={SECTION_TITLE}>Media</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="block min-w-0">
            <span className="text-[11px] text-slate-500">
              Photo{editing ? " · leave blank to keep current" : ""}
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
            <span className="text-[11px] text-slate-500">Video (optional)</span>
            <FilePicker
              accept="video/*"
              file={video}
              onPick={setVideo}
              label="Choose video"
              className="mt-1 w-full"
            />
          </div>
        </div>
      </section>

      {/* TDS sheet — travels with the product into the combined PDF. */}
      <section className={SECTION_BOX}>
        <div className={SECTION_TITLE}>TDS sheet (PDF)</div>
        <p className="text-[11px] text-slate-500 -mt-1 mb-2 leading-snug">
          The technical data sheet for this product. Add it now or later — when
          this product is added to a court design, its TDS is included in the
          combined PDF automatically.
        </p>
        {existingTds.length > 0 && (
          <ul className="space-y-1.5 mb-2">
            {existingTds.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 text-sm bg-slate-50 border border-slate-200 rounded-md px-3 py-2"
              >
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 text-wa-dark hover:underline truncate"
                >
                  📄 {t.name}
                </a>
                <button
                  type="button"
                  onClick={() => removeTdsFile(t.id)}
                  className="shrink-0 text-xs text-red-500 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <FilePicker
          accept="application/pdf,.pdf"
          file={tdsFile}
          onPick={setTdsFile}
          label={existingTds.length > 0 ? "Add another TDS PDF" : "Choose TDS PDF"}
          className="w-full"
        />
      </section>

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={busy}
          className="bg-wa-green hover:bg-wa-green/90 text-white text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-50"
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Save product"}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editFile, setEditFile] = useState<File | null>(null);

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

  function startEdit(f: { id: string; name: string }) {
    setEditingId(f.id);
    setEditName(f.name);
    setEditFile(null);
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) {
      toast.error("Name required");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("id", id);
    form.set("name", editName.trim());
    if (editFile) form.set("file", editFile);
    const r = await fetch("/api/products/tds", { method: "PATCH", body: form });
    setBusy(false);
    if (r.ok) {
      toast.success("Updated");
      setEditingId(null);
      setEditFile(null);
      load(sport);
    } else {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "Save failed");
    }
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
              className="bg-white border border-slate-200 rounded-md px-3 py-2 text-sm"
            >
              {editingId === f.id ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Display name"
                    className="input flex-1 min-w-0"
                  />
                  <FilePicker
                    accept="application/pdf,.pdf"
                    file={editFile}
                    onPick={setEditFile}
                    label="Replace PDF"
                    className="flex-1 min-w-0 sm:min-w-[9rem]"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busy || !editName.trim()}
                      onClick={() => saveEdit(f.id)}
                      className="bg-wa-green hover:bg-wa-green/90 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-xs text-slate-500 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
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
                    onClick={() => startEdit(f)}
                    className="text-xs text-wa-dark hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              )}
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
