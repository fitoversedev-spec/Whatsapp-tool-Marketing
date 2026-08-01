// Invoice naming: "<CustomerName>.inv (<Sport>)" — e.g. "Jay.inv (Football)".
// A "(2)", "(3)" … suffix is appended only when the same customer already has an
// invoice for the same sport, so the human-readable number stays unique (the
// Invoice.number column is @unique). Mirrors the max+retry approach the quote
// route uses for FIT-QT numbers.

import { prisma } from "@/lib/prisma";

function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// A nice sport label — the Sport taxonomy name if we have it, else a
// title-cased slug ("box_cricket" → "Box Cricket").
export async function sportLabel(slug: string): Promise<string> {
  const sport = await prisma.sport.findUnique({ where: { slug }, select: { name: true } }).catch(() => null);
  return sport?.name?.trim() || titleCase(slug);
}

// The base name without any collision suffix.
export function baseInvoiceName(customerName: string, sport: string): string {
  const name = customerName.trim().replace(/\s+/g, " ") || "Customer";
  return `${name}.inv (${sport})`;
}

// Resolve the next unique invoice number for this customer + sport. Returns the
// base name if free, else the lowest available "(n)" suffix. The create call
// still catches P2002 and retries, in case of a race between check and insert.
export async function nextInvoiceNumber(customerName: string, sportSlug: string): Promise<string> {
  const label = await sportLabel(sportSlug);
  const base = baseInvoiceName(customerName, label);
  const existing = await prisma.invoice.findMany({
    where: { number: { startsWith: base } },
    select: { number: true },
  });
  if (!existing.some((e) => e.number === base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`;
    if (!existing.some((e) => e.number === candidate)) return candidate;
  }
  // Extremely unlikely fallback — keep it unique with a timestamp-ish tail.
  return `${base} (${existing.length + 1})`;
}
