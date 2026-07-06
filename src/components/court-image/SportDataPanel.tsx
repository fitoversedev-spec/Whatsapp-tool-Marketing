"use client";

// Sport Data Panel — sidebar in the Court Designer's Step 2 that pulls
// per-sport reference data: product photos + descriptions (from MVPv2)
// and TDS PDFs (from the admin uploads).
//
// Aligned with the Doc 2 data-format ask (photos / documents / written
// data). Two-stage interaction per Q4.1: first tap shows a preview
// inline; a second tap ("Pin to canvas") adds a labelled annotation
// pointing to the plot centre so sales can call out that product on
// the design.

import { useEffect, useState } from "react";
import type { MvpProduct } from "@/lib/mvpv2/products";
import type { SportTdsFile } from "@/lib/court-image/sport-tds";
import type { Sport } from "@/lib/court-image/schema";

type Tab = "photos" | "documents" | "written";

export default function SportDataPanel({
  sports,
  primarySport,
  onPinProduct,
}: {
  sports: Sport[];
  primarySport?: Sport;
  onPinProduct: (label: string) => void;
}) {
  const [activeSport, setActiveSport] = useState<Sport>(
    primarySport ?? sports[0] ?? ("football" as Sport),
  );
  const [tab, setTab] = useState<Tab>("photos");
  const [products, setProducts] = useState<MvpProduct[]>([]);
  const [tds, setTds] = useState<SportTdsFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MvpProduct | null>(null);

  useEffect(() => {
    setSelected(null);
    setLoading(true);
    Promise.all([
      fetch(`/api/mvpv2/products?sport=${activeSport}`)
        .then((r) => r.json())
        .catch(() => ({ products: [] })),
      fetch(`/api/admin/sport-tds?sport=${activeSport}`)
        .then((r) => r.json())
        .catch(() => ({ files: [] })),
    ])
      .then(([p, t]) => {
        setProducts(p.products ?? []);
        setTds(t.files ?? []);
      })
      .finally(() => setLoading(false));
  }, [activeSport]);

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "photos", label: "Photos", count: products.filter((p) => !!p.image_url).length },
    { id: "documents", label: "Documents", count: tds.length },
    { id: "written", label: "Written", count: products.length },
  ];

  return (
    <div className="border-t border-slate-200 pt-4 space-y-3">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
        Fitoverse products
      </div>

      {sports.length > 1 && (
        <select
          value={activeSport}
          onChange={(e) => setActiveSport(e.target.value as Sport)}
          className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
        >
          {sports.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}

      <div className="flex gap-1 border-b border-slate-200 -mb-px">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-2.5 py-1.5 text-[11px] font-medium border-b-2 transition ${
              tab === t.id
                ? "border-wa-green text-wa-dark"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-1 text-[10px] text-slate-400">
                ({t.count})
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-[11px] text-slate-500 italic py-3">
          Loading {activeSport} data…
        </div>
      ) : tab === "photos" ? (
        <PhotoGrid
          products={products.filter((p) => !!p.image_url)}
          selected={selected}
          onSelect={setSelected}
          onPin={(p) => onPinProduct(p.name.trim())}
        />
      ) : tab === "documents" ? (
        <DocumentList sport={activeSport} files={tds} />
      ) : (
        <WrittenList
          products={products}
          selected={selected}
          onSelect={setSelected}
          onPin={(p) => onPinProduct(p.name.trim())}
        />
      )}
    </div>
  );
}

function PhotoGrid({
  products,
  selected,
  onSelect,
  onPin,
}: {
  products: MvpProduct[];
  selected: MvpProduct | null;
  onSelect: (p: MvpProduct | null) => void;
  onPin: (p: MvpProduct) => void;
}) {
  if (products.length === 0) {
    return (
      <div className="text-[11px] text-slate-500 italic py-3">
        No product photos for this sport yet in MVPv2.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        {products.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(selected?.id === p.id ? null : p)}
            className={`aspect-square rounded-md overflow-hidden border transition ${
              selected?.id === p.id
                ? "border-wa-green ring-2 ring-wa-green/30"
                : "border-slate-200 hover:border-slate-400"
            }`}
            title={p.name.trim()}
          >
            {p.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.image_url}
                alt={p.name.trim()}
                className="w-full h-full object-cover"
              />
            )}
          </button>
        ))}
      </div>
      {selected && (
        <PreviewCard product={selected} onPin={() => onPin(selected)} />
      )}
    </div>
  );
}

function WrittenList({
  products,
  selected,
  onSelect,
  onPin,
}: {
  products: MvpProduct[];
  selected: MvpProduct | null;
  onSelect: (p: MvpProduct | null) => void;
  onPin: (p: MvpProduct) => void;
}) {
  if (products.length === 0) {
    return (
      <div className="text-[11px] text-slate-500 italic py-3">
        No products written up for this sport yet.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {products.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(selected?.id === p.id ? null : p)}
              className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition ${
                selected?.id === p.id
                  ? "bg-wa-green/10 text-wa-dark"
                  : "hover:bg-slate-50 text-slate-700"
              }`}
            >
              {p.name.trim()}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <PreviewCard product={selected} onPin={() => onPin(selected)} />
      )}
    </div>
  );
}

function PreviewCard({
  product,
  onPin,
}: {
  product: MvpProduct;
  onPin: () => void;
}) {
  const text = stripHtml(product.description).slice(0, 260);
  return (
    <div className="border border-slate-200 rounded-md p-2.5 bg-slate-50 space-y-2">
      {product.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.image_url}
          alt={product.name.trim()}
          className="w-full aspect-video object-cover rounded"
        />
      )}
      <div className="text-xs font-medium text-slate-900">
        {product.name.trim()}
      </div>
      {text && (
        <div className="text-[11px] text-slate-600 leading-snug">{text}…</div>
      )}
      <button
        type="button"
        onClick={onPin}
        className="w-full bg-wa-green hover:bg-wa-green/90 text-white text-xs font-medium py-1.5 rounded-md"
      >
        Pin to canvas
      </button>
    </div>
  );
}

function DocumentList({
  sport,
  files,
}: {
  sport: string;
  files: SportTdsFile[];
}) {
  if (files.length === 0) {
    return (
      <div className="text-[11px] text-slate-500 italic py-3 leading-snug">
        No TDS PDFs uploaded for {sport}. Admin can add them via{" "}
        <a href="/admin/sport-tds" className="underline text-wa-dark">
          /admin/sport-tds
        </a>
        .
      </div>
    );
  }
  return (
    <ul className="space-y-1">
      {files.map((f) => (
        <li key={f.url}>
          <a
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-2 py-1.5 rounded-md text-xs text-wa-dark hover:bg-slate-50 border border-slate-200 truncate"
          >
            📄 {f.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
