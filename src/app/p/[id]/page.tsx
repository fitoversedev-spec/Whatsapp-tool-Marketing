// Public, unauthenticated product detail page — the customer-facing target
// of the chatbot's product-card "View" button. Lives OUTSIDE the (dashboard)
// route group, so it inherits only the root layout (fonts + theme) and gets
// none of the app sidebar/chrome or auth gate — same spirit as the /q/[id]
// and /d/[id] public links, but a full rendered page rather than a redirect.
//
// Opens inside WhatsApp's in-app browser, so it's mobile-first. Reads the
// product (with its ProductMedia gallery, already sorted by sortOrder) via
// getProduct(); unknown ids 404 through notFound().

import { Fragment } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProduct } from "@/lib/products/store";
import { htmlToWhatsappText } from "@/lib/products/format";

// Product content is DB-backed and edited live from the Products page, so
// never statically cache this route — always render the current record.
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  flooring: "Flooring",
  material: "Material",
  equipment: "Equipment",
};

function titleCase(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const product = await getProduct(params.id).catch(() => null);
  if (!product) return { title: "Product — Fitoverse" };
  const desc = htmlToWhatsappText(product.description)
    .replace(/[*_]/g, "")
    .slice(0, 160);
  return {
    title: `${product.name} — Fitoverse`,
    description: desc || undefined,
    openGraph: {
      title: `${product.name} — Fitoverse`,
      description: desc || undefined,
      images: product.heroImageUrl ? [{ url: product.heroImageUrl }] : undefined,
    },
  };
}

// Render WhatsApp-style text (from htmlToWhatsappText) as real HTML without
// dangerouslySetInnerHTML: *bold* / _italic_ become <strong>/<em>, "• " lines
// become list items, blank lines separate paragraphs.
function renderInline(s: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("*")) {
      parts.push(
        <strong key={key++} className="font-semibold text-slate-900">
          {tok.slice(1, -1)}
        </strong>,
      );
    } else {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <div className="space-y-3 text-slate-700 leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList =
          lines.length > 0 && lines.every((l) => l.trim().startsWith("• "));
        if (isList) {
          return (
            <ul key={bi} className="space-y-1.5 pl-1">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-turf-500" />
                  <span>{renderInline(l.replace(/^•\s*/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export default async function ProductPage({
  params,
}: {
  params: { id: string };
}) {
  const product = await getProduct(params.id);
  if (!product) notFound();

  const description = htmlToWhatsappText(product.description);
  // specs is free-form JSON, so a non-string value (e.g. {"weight": 42}) would
  // make v.trim() throw a 500 on this public page — keep only non-empty strings.
  const specEntries = Object.entries(product.specs).filter(
    ([, v]) => typeof v === "string" && v.trim(),
  );

  // Hero image, resolved first (falls back to the first gallery image when
  // heroImageUrl is null) so the gallery can dedupe against what's ACTUALLY
  // shown as the hero — otherwise a null-hero product shows its first gallery
  // image both as the hero and in the grid.
  const heroUrl =
    product.heroImageUrl ??
    product.media.find((m) => m.kind === "image")?.url ??
    null;
  const galleryImages = product.media.filter(
    (m) => m.kind === "image" && m.url !== heroUrl,
  );

  // Videos: the product-level videoUrl plus any "video" gallery media.
  const videoUrls = [
    ...(product.videoUrl ? [product.videoUrl] : []),
    ...product.media.filter((m) => m.kind === "video").map((m) => m.url),
  ];

  const typeLabel = TYPE_LABELS[product.type] ?? titleCase(product.type);

  return (
    <main className="min-h-screen bg-slate-50 pb-14">
      {/* Brand bar */}
      <header className="bg-gradient-to-r from-court-700 to-turf-600 px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="font-heading text-lg font-extrabold uppercase tracking-tight text-white">
            Fitoverse
          </span>
          <span className="font-heading text-[0.65rem] font-bold uppercase tracking-wide text-white/80">
            Sports Infrastructure
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4">
        {/* Hero image */}
        {heroUrl && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroUrl}
              alt={product.name}
              className="aspect-[4/3] w-full object-cover"
            />
          </div>
        )}

        {/* Title block */}
        <section className="mt-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-court-50 text-court-700">{typeLabel}</span>
            {product.category && (
              <span className="badge bg-slate-100 text-slate-600">
                {titleCase(product.category)}
              </span>
            )}
            {product.featured && (
              <span className="badge bg-mint-100 text-turf-700">Featured</span>
            )}
          </div>

          <h1 className="mt-3 text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">
            {product.name}
          </h1>

          {product.sports.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {product.sports.map((s) => (
                <span key={s} className="chip">
                  {titleCase(s)}
                </span>
              ))}
            </div>
          )}

          {product.priceInr != null && (
            <div className="mt-4 inline-flex items-baseline gap-2 rounded-lg border border-turf-200 bg-turf-50 px-4 py-2">
              <span className="num text-xl font-bold text-turf-700">
                ₹{product.priceInr.toLocaleString("en-IN")}
              </span>
              {product.unit && (
                <span className="text-sm text-turf-600">/ {product.unit}</span>
              )}
              <span className="ml-1 text-xs text-slate-500">indicative</span>
            </div>
          )}
        </section>

        {/* Description */}
        {description && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
              Overview
            </h2>
            <RichText text={description} />
          </section>
        )}

        {/* Specs table */}
        {specEntries.length > 0 && (
          <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm font-bold uppercase tracking-wide text-slate-500">
              Specifications
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {specEntries.map(([key, val], i) => (
                  <tr
                    key={key}
                    className={i % 2 === 1 ? "bg-slate-50/60" : undefined}
                  >
                    <th className="w-2/5 border-b border-slate-100 px-5 py-3 text-left align-top font-semibold text-slate-600">
                      {titleCase(key)}
                    </th>
                    <td className="border-b border-slate-100 px-5 py-3 align-top text-slate-800">
                      {String(val)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Gallery */}
        {galleryImages.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
              Gallery
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {galleryImages.map((m) => (
                <a
                  key={m.id}
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.url}
                    alt={m.caption ?? product.name}
                    className="aspect-square w-full object-cover transition group-hover:scale-[1.03]"
                  />
                  {m.caption && (
                    <p className="px-2 py-1.5 text-xs text-slate-500">
                      {m.caption}
                    </p>
                  )}
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Videos */}
        {videoUrls.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
              Video
            </h2>
            <div className="space-y-3">
              {videoUrls.map((url) => (
                <video
                  key={url}
                  src={url}
                  controls
                  playsInline
                  className="w-full rounded-2xl border border-slate-200 bg-black shadow-sm"
                />
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="mt-8 rounded-2xl border border-court-200 bg-court-50 p-5 text-center">
          <p className="text-slate-700">
            Interested in <span className="font-semibold">{product.name}</span>?
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Reply <span className="font-semibold text-court-700">Interested</span>{" "}
            on WhatsApp and our team will follow up with pricing and next steps.
          </p>
        </section>

        <footer className="mt-8 text-center text-xs text-slate-400">
          Fitoverse — Sports Infrastructure &amp; Turnkey Court Solutions
        </footer>
      </div>
    </main>
  );
}
