// Client for the MVPv2 product catalogue API.
//
// MVPv2 is Fitoverse's sibling web tool (fitoverse.vercel.app) that
// hosts the master product catalogue with images, descriptions, and
// spec tables. The WhatsApp tool fetches from it at runtime rather
// than duplicating product data.
//
// Public endpoints (unauthenticated, rate-limited 100 req/min):
//   GET /api/products?sport=<key>          — filtered listing
//   GET /api/products/:id                  — single product
//   GET /api/products/meta/sports          — sport metadata
//   GET /api/products/meta/categories      — category metadata
//
// The sport IDs in MVPv2 match this project's SportKey enum exactly
// (football, basketball, cricket, tennis, badminton, volleyball,
// pickleball, multisport), so no translation layer is needed.
//
// Images are already on Vercel Blob CDN — the URLs returned here can
// be sent directly in WhatsApp media messages with no re-hosting.

import type { SportKey } from "@/lib/catalogue/sport-meta";

// Runtime base URL. Defaults to the Vercel front-door which proxies
// /api/* to the Railway backend. Override in .env.local if we ever
// point at a Railway URL directly.
const BASE_URL = (
  process.env.MVPV2_API_URL ?? "https://fitoverse.vercel.app/api"
).replace(/\/$/, "");

const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 1000;

// ------- types ------------------------------------------------------------

export type MvpSportRef = {
  id: string;
  name: string;
  icon: string;
};

export type MvpCategoryRef = {
  id: string;
  name: string;
};

// Shape returned by GET /api/products and GET /api/products/:id.
// Description is HTML from a tiptap editor — call htmlToWhatsappText()
// before sending it in a WhatsApp message.
export type MvpProduct = {
  id: string;
  name: string;
  description: string;
  image_url: string | null;
  specs: Record<string, string> | null;
  featured: boolean;
  estimated_cost: number | string | null;
  category_id: string | null;
  category_name: string | null;
  categories: MvpCategoryRef[];
  sports: MvpSportRef[];
  // Present on GET /api/products/:id, absent on the list endpoint.
  images?: Array<{ id: string; image_url: string; sort_order: number }>;
  rating?: number;
  review_count?: number;
};

// ------- in-memory cache ---------------------------------------------------

type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cacheSet<T>(key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ------- HTTP helper -------------------------------------------------------

async function get<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!r.ok) {
      throw new Error(`mvpv2 ${r.status} ${r.statusText} for ${path}`);
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ------- public API --------------------------------------------------------

export async function listProductsBySport(
  sport: SportKey,
  { featuredOnly = false }: { featuredOnly?: boolean } = {},
): Promise<MvpProduct[]> {
  const cacheKey = `list:${sport}:${featuredOnly ? "featured" : "all"}`;
  const cached = cacheGet<MvpProduct[]>(cacheKey);
  if (cached) return cached;

  const qs = new URLSearchParams({ sport });
  if (featuredOnly) qs.set("featured", "true");
  const data = await get<{ products: MvpProduct[] }>(`/products?${qs}`);
  const products = data.products ?? [];
  cacheSet(cacheKey, products);
  return products;
}

export async function getProduct(id: string): Promise<MvpProduct | null> {
  const cacheKey = `product:${id}`;
  const cached = cacheGet<MvpProduct>(cacheKey);
  if (cached) return cached;

  try {
    // Single-product endpoint may return either { product: ... } or the
    // product directly. Handle both.
    const raw = await get<{ product?: MvpProduct } & MvpProduct>(
      `/products/${encodeURIComponent(id)}`,
    );
    const product = raw.product ?? raw;
    if (!product || !product.id) return null;
    cacheSet(cacheKey, product);
    return product;
  } catch (err) {
    console.error("[mvpv2] getProduct failed", id, err);
    return null;
  }
}

export async function listSports(): Promise<MvpSportRef[]> {
  const cacheKey = "meta:sports";
  const cached = cacheGet<MvpSportRef[]>(cacheKey);
  if (cached) return cached;

  const data = await get<{ sports: MvpSportRef[] }>("/products/meta/sports");
  const sports = data.sports ?? [];
  cacheSet(cacheKey, sports);
  return sports;
}

export async function listCategories(): Promise<MvpCategoryRef[]> {
  const cacheKey = "meta:categories";
  const cached = cacheGet<MvpCategoryRef[]>(cacheKey);
  if (cached) return cached;

  const data = await get<{ categories: MvpCategoryRef[] }>(
    "/products/meta/categories",
  );
  const categories = data.categories ?? [];
  cacheSet(cacheKey, categories);
  return categories;
}

// ------- WhatsApp formatting helpers --------------------------------------

// Convert tiptap-style HTML descriptions into text WhatsApp will render
// cleanly. WhatsApp text formatting: *bold*, _italic_, ~strike~, ```mono```.
// Keeps content, drops layout. Idempotent when passed plain text.
export function htmlToWhatsappText(html: string): string {
  if (!html) return "";
  let s = html;

  // Headings first — must run BEFORE the generic close-tag handler so
  // the closing `*` isn't eaten. WhatsApp uses *bold*.
  s = s.replace(/<(h[1-6])[^>]*>\s*/gi, "\n*");
  s = s.replace(/\s*<\/(h[1-6])>/gi, "*\n");

  // Inline formatting.
  s = s.replace(/<(strong|b)[^>]*>/gi, "*");
  s = s.replace(/<\/(strong|b)>/gi, "*");
  s = s.replace(/<(em|i)[^>]*>/gi, "_");
  s = s.replace(/<\/(em|i)>/gi, "_");

  // Table cells → separated by " · " so key/value pairs stay readable.
  s = s.replace(/<\/(th|td)>\s*<(th|td)[^>]*>/gi, " · ");
  s = s.replace(/<(th|td)[^>]*>/gi, "");
  s = s.replace(/<\/(th|td)>/gi, "");
  s = s.replace(/<\/tr>/gi, "\n");
  s = s.replace(/<(tr|table|tbody|thead|colgroup)[^>]*>/gi, "");
  s = s.replace(/<\/(table|tbody|thead|colgroup)>/gi, "");
  s = s.replace(/<col[^>]*\/?>/gi, "");

  // List items.
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<\/li>/gi, "\n");
  s = s.replace(/<(ul|ol)[^>]*>/gi, "");
  s = s.replace(/<\/(ul|ol)>/gi, "");

  // Generic blocks.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div)\s*>/gi, "\n");
  s = s.replace(/<(p|div)[^>]*>/gi, "");

  // Drop everything else.
  s = s.replace(/<[^>]+>/g, "");

  // Decode a small set of common HTML entities that tiptap emits.
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&rsquo;": "'",
    "&lsquo;": "'",
    "&ldquo;": '"',
    "&rdquo;": '"',
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
  };
  s = s.replace(/&[a-z#0-9]+;/gi, (m) => entities[m] ?? m);

  // Collapse runs of blank lines / trailing whitespace.
  s = s
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();

  return s;
}

// Formats a product's spec JSON as a WhatsApp-friendly key/value block.
// Skips empty values.
export function specsToWhatsappBlock(
  specs: Record<string, string> | null | undefined,
): string {
  if (!specs) return "";
  const lines: string[] = [];
  for (const [key, val] of Object.entries(specs)) {
    if (!val || !val.trim()) continue;
    const label = key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
    lines.push(`• *${label}:* ${val.trim()}`);
  }
  return lines.join("\n");
}

// Test-only helpers.
export function _clearCache(): void {
  cache.clear();
}

export function _baseUrl(): string {
  return BASE_URL;
}
