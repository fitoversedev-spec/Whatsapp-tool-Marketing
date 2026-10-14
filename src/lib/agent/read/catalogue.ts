import { getActiveProductsByIds, listProducts, type ProductDTO } from "@/lib/products/store";
import { AgentHttpError } from "../errors";
import { PRICE_STATUS, type AgentProduct, type CatalogueSearchInput } from "../schemas/read";
import { pageById, requireId } from "./shared";

/**
 * Product catalogue for the agent. Specs, media and the titles of technical
 * data sheets are shown; the catalogue's rupee figure is only ever an
 * indicative, unconfirmed price, never "the price". TDS file URLs are not
 * returned (the documents tools send them by id).
 */

export const AVAILABILITY_MESSAGE = "Stock and delivery are confirmed by the Fitoverse team.";

// Free-text spec fields can carry a price someone typed in (e.g. "priceRange").
// The AI may only quote rate-sheet prices, so those keys never reach it.
const PRICE_SPEC_KEY = /\b(price|prices|pricing|cost|costs|rate|rates|discount|mrp|inr|amount)\b|₹/i;
export function agentSpecs(specs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(specs).filter(([k]) => !PRICE_SPEC_KEY.test(k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " "))),
  );
}

export function toAgentProduct(p: ProductDTO): AgentProduct {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    category: p.category,
    description: p.description,
    sports: p.sports,
    specs: agentSpecs(p.specs),
    featured: p.featured,
    indicativePrice:
      p.priceInr != null ? { amountInr: p.priceInr, unit: p.unit, priceStatus: PRICE_STATUS } : null,
    heroImageUrl: p.heroImageUrl,
    media: p.media.map((m) => ({ kind: m.kind, url: m.url, caption: m.caption })),
    tdsDocuments: p.tdsFiles.map((t) => ({ id: t.id, title: t.name, sport: t.sport })),
  };
}

/** Every word of the search text must appear somewhere in the product's text. */
export function matchesQuery(p: ProductDTO, q: string): boolean {
  const hay = [p.name, p.description, p.category ?? "", p.type, p.sports.join(" "), ...Object.entries(p.specs).flat()]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

export async function searchCatalogue(input: Pick<CatalogueSearchInput, "q" | "sport" | "type" | "limit" | "cursor">) {
  const all = await listProducts({ type: input.type, sport: input.sport?.toLowerCase() });
  const filtered = input.q ? all.filter((p) => matchesQuery(p, input.q!)) : all;
  const page = pageById(filtered, input.limit, input.cursor);
  return { items: page.items.map(toAgentProduct), nextCursor: page.nextCursor };
}

export async function getProductForAgent(rawId: string | undefined): Promise<AgentProduct> {
  const id = requireId(rawId, "Product");
  const [product] = await getActiveProductsByIds([id]);
  if (!product) throw new AgentHttpError("not_found", "Product not found.");
  return toAgentProduct(product);
}

export async function checkAvailability(rawId: string | undefined) {
  const id = requireId(rawId, "Product");
  const [product] = await getActiveProductsByIds([id]);
  if (!product) throw new AgentHttpError("not_found", "Product not found.");
  return { productId: id, status: "unknown" as const, message: AVAILABILITY_MESSAGE };
}

// ---- compare_products -----------------------------------------------------

const specKey = (k: string): string => k.trim().replace(/\s+/g, " ").toLowerCase();
const specVal = (v: string): string => v.trim().replace(/\s+/g, " ").toLowerCase();

/** Pure: line the products' specs up side by side and say which ones differ. */
export function compareProductSpecs(products: ProductDTO[]) {
  const labels = new Map<string, string>(); // normalised key -> first label seen
  for (const p of products) {
    for (const k of Object.keys(agentSpecs(p.specs))) if (!labels.has(specKey(k))) labels.set(specKey(k), k.trim());
  }
  const specs = [...labels.entries()].map(([key, label]) => {
    const values: Record<string, string | null> = {};
    const seen = new Set<string>();
    let missing = false;
    for (const p of products) {
      const entry = Object.entries(agentSpecs(p.specs)).find(([k]) => specKey(k) === key);
      const value = entry && entry[1].trim() !== "" ? entry[1].trim() : null;
      values[p.id] = value;
      if (value === null) missing = true;
      else seen.add(specVal(value));
    }
    return { spec: label, values, differs: missing || seen.size > 1 };
  });
  return {
    products: products.map((p) => {
      const a = toAgentProduct(p);
      return { id: a.id, name: a.name, type: a.type, category: a.category, sports: a.sports, indicativePrice: a.indicativePrice };
    }),
    specs,
    differingSpecs: specs.filter((s) => s.differs).map((s) => s.spec),
    commonSpecs: specs.filter((s) => !s.differs).map((s) => s.spec),
  };
}

export async function compareProductsByIds(productIds: string[]) {
  const ids = [...new Set(productIds)];
  if (ids.length < 2) throw new AgentHttpError("invalid_input", "Give at least 2 different products to compare.");
  const found = await getActiveProductsByIds(ids);
  if (found.length !== ids.length) {
    const have = new Set(found.map((p) => p.id));
    throw new AgentHttpError("not_found", `Product(s) not found: ${ids.filter((i) => !have.has(i)).join(", ")}.`);
  }
  return compareProductSpecs(found);
}
