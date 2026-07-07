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
  const [adding, setAdding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
  }, [tab, activeSport, refreshKey]);

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

      {/* Inline add — create a product / equipment / TDS right here
          without leaving the canvas (so the design isn't lost). */}
      <button
        type="button"
        onClick={() => setAdding((a) => !a)}
        className="block w-full text-center text-[11px] text-wa-dark hover:bg-wa-green/5 border border-dashed border-wa-green/40 rounded-md py-1.5"
      >
        {adding ? "Cancel" : `+ Add ${tab === "tds" ? "TDS" : tab === "equipment" ? "equipment" : "product"} here`}
      </button>
      {adding && (
        <InlineAddForm
          tab={tab}
          sport={activeSport}
          onDone={() => {
            setAdding(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

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

// Compact inline creator for a product / equipment / TDS. Posts to the
// same APIs the Products page uses, then the parent refreshes the list.
// Sport is pre-filled from the active sport so it shows up immediately.
function InlineAddForm({
  tab,
  sport,
  onDone,
}: {
  tab: AttachmentTab;
  sport: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr("Name required");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      if (tab === "tds") {
        if (!file) {
          setErr("PDF required");
          setBusy(false);
          return;
        }
        form.set("sport", sport);
        form.set("name", name.trim());
        form.set("file", file);
        const r = await fetch("/api/products/tds", { method: "POST", body: form });
        if (!r.ok) throw new Error((await r.json()).error ?? "failed");
      } else {
        form.set("name", name.trim());
        form.set("type", tab === "equipment" ? "equipment" : "flooring");
        form.set("description", description);
        form.set("sports", JSON.stringify([sport]));
        if (file) form.set("hero", file);
        const r = await fetch("/api/products", { method: "POST", body: form });
        if (!r.ok) throw new Error((await r.json()).error ?? "failed");
      }
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="border border-slate-200 rounded-md bg-white p-2 space-y-1.5"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={
          tab === "tds"
            ? "TDS name (e.g. Turf 50mm — TDS)"
            : tab === "equipment"
              ? "Equipment name (e.g. Goal post)"
              : "Product name (e.g. Turf 50mm)"
        }
        className="w-full px-2 py-1.5 text-[11px] border border-slate-300 rounded"
      />
      {tab !== "tds" && (
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Short description (optional)"
          className="w-full px-2 py-1.5 text-[11px] border border-slate-300 rounded resize-none"
        />
      )}
      <input
        type="file"
        accept={tab === "tds" ? "application/pdf" : "image/*"}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="w-full text-[11px]"
      />
      {err && <div className="text-[10.5px] text-red-500">{err}</div>}
      <div className="text-[10px] text-slate-400">
        Adds to <span className="capitalize">{sport}</span>.
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full bg-wa-green hover:bg-wa-green/90 text-white text-[11px] font-medium py-1.5 rounded disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save & attach"}
      </button>
    </form>
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
