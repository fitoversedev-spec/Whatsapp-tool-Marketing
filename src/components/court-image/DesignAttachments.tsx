"use client";

// Step 2 sidebar tabs for attaching catalogue items to a court design:
// Products (flooring + material), Equipment, and TDS sheets. Selections
// are stored on layout.attachments and flow into the combined PDF.
//
// Each tab lists items for the design's sports with a checkbox to
// attach, and a "+ Add new" affordance that opens the Products page in
// a new tab (so sales can add a product without losing the design).

import { useEffect, useState } from "react";
import type { ProductDTO, TdsDTO } from "@/lib/products/store";
import type { Sport } from "@/lib/court-image/schema";

export type AttachmentTab = "products" | "equipment" | "tds";

export type Attachments = {
  productIds: string[];
  equipmentIds: string[];
  tdsIds: string[];
};

export default function DesignAttachments({
  tab,
  sports,
  attachments,
  onChange,
  onFlooringPicked,
}: {
  tab: AttachmentTab;
  sports: Sport[];
  attachments: Attachments;
  onChange: (next: Attachments) => void;
  // Fires when a flooring/material product is checked ON, so the wizard
  // can apply its appearance to the canvas + record it as the design's
  // flooring. Only called for the Products tab (not equipment / TDS).
  onFlooringPicked?: (product: ProductDTO) => void;
}) {
  const primarySport = sports[0] ?? "football";
  const [activeSport, setActiveSport] = useState<string>(primarySport);
  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [tds, setTds] = useState<TdsDTO[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setActiveSport(primarySport);
  }, [primarySport]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (tab === "tds") {
      fetch(`/api/products/tds?sport=${activeSport}`)
        .then((r) => r.json())
        .then((j) => {
          if (!cancelled) setTds(j.files ?? []);
        })
        .catch(() => !cancelled && setTds([]))
        .finally(() => !cancelled && setLoading(false));
    } else {
      const typeQ = tab === "equipment" ? "&type=equipment" : "";
      fetch(`/api/products?sport=${activeSport}${typeQ}`)
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return;
          let list: ProductDTO[] = j.products ?? [];
          // Products tab = flooring + material (not equipment).
          if (tab === "products") {
            list = list.filter((p) => p.type !== "equipment");
          }
          setProducts(list);
        })
        .catch(() => !cancelled && setProducts([]))
        .finally(() => !cancelled && setLoading(false));
    }
    return () => {
      cancelled = true;
    };
  }, [tab, activeSport]);

  function toggleProduct(id: string, isEquipment: boolean) {
    const key = isEquipment ? "equipmentIds" : "productIds";
    const cur = attachments[key];
    const turningOn = !cur.includes(id);
    const next = turningOn ? [...cur, id] : cur.filter((x) => x !== id);
    onChange({ ...attachments, [key]: next });
    // When a flooring/material product is checked on, reflect it on the
    // canvas (apply its surface + record it as the design's flooring).
    if (turningOn && !isEquipment && onFlooringPicked) {
      const p = products.find((x) => x.id === id);
      if (p && (p.type === "flooring" || p.type === "material")) {
        onFlooringPicked(p);
      }
    }
  }
  function toggleTds(id: string) {
    const cur = attachments.tdsIds;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onChange({ ...attachments, tdsIds: next });
  }

  return (
    <div className="space-y-3">
      {/* Sport switcher when the design has 2+ sports */}
      {sports.length > 1 && (
        <select
          value={activeSport}
          onChange={(e) => setActiveSport(e.target.value)}
          className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-white capitalize"
        >
          {sports.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}

      <a
        href="/products"
        target="_blank"
        rel="noopener noreferrer"
        className="block text-center text-[11px] text-wa-dark hover:underline border border-dashed border-wa-green/40 rounded-md py-1.5"
      >
        + Add new in Products page ↗
      </a>

      {loading ? (
        <div className="text-[11px] text-slate-500 italic py-2">Loading…</div>
      ) : tab === "tds" ? (
        tds.length === 0 ? (
          <Empty label="TDS sheets" sport={activeSport} />
        ) : (
          <ul className="space-y-1">
            {tds.map((t) => {
              const checked = attachments.tdsIds.includes(t.id);
              return (
                <li key={t.id}>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTds(t.id)}
                      className="accent-wa-green"
                    />
                    <span className="text-[11px] text-slate-700 truncate flex-1">
                      📄 {t.name}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )
      ) : products.length === 0 ? (
        <Empty label={tab === "equipment" ? "equipment" : "products"} sport={activeSport} />
      ) : (
        <div className="space-y-1.5">
          {products.map((p) => {
            const isEquip = p.type === "equipment";
            const checked = (
              isEquip ? attachments.equipmentIds : attachments.productIds
            ).includes(p.id);
            return (
              <label
                key={p.id}
                className={`flex items-center gap-2 p-1.5 rounded-md border cursor-pointer transition ${
                  checked
                    ? "border-wa-green bg-wa-green/5"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleProduct(p.id, isEquip)}
                  className="accent-wa-green shrink-0"
                />
                <span className="w-9 h-9 rounded bg-slate-100 overflow-hidden shrink-0">
                  {p.heroImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.heroImageUrl}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium text-slate-800 leading-tight truncate">
                    {p.name}
                  </span>
                  {p.priceInr != null && (
                    <span className="block text-[10px] text-slate-500">
                      ₹{p.priceInr.toLocaleString("en-IN")}
                      {p.unit ? ` / ${p.unit}` : ""}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <SelectionSummary attachments={attachments} />
    </div>
  );
}

function Empty({ label, sport }: { label: string; sport: string }) {
  return (
    <div className="text-[11px] text-slate-500 italic bg-slate-50 border border-slate-200 rounded-md px-2.5 py-2">
      No {label} for <span className="capitalize">{sport}</span> yet. Add
      them in the Products page.
    </div>
  );
}

function SelectionSummary({ attachments }: { attachments: Attachments }) {
  const total =
    attachments.productIds.length +
    attachments.equipmentIds.length +
    attachments.tdsIds.length;
  if (total === 0) return null;
  return (
    <div className="text-[10.5px] text-slate-500 border-t border-slate-200 pt-2">
      Attached: {attachments.productIds.length} product
      {attachments.productIds.length !== 1 ? "s" : ""} ·{" "}
      {attachments.equipmentIds.length} equipment ·{" "}
      {attachments.tdsIds.length} TDS
    </div>
  );
}
