// Per-sport TDS (Technical Data Sheet) PDF storage.
//
// Fitoverse sales asks for TDS sheets to hand out per sport during a
// design conversation. Rather than tie them to individual products in
// MVPv2, we store one bucket per sport in this project's Setting table
// (same pattern as the sport catalogue PDFs). Admin uploads a PDF via
// /admin/sport-tds, which stashes it in Vercel Blob and appends the URL
// + display name to the setting row.
//
// The wizard's Sport Data Panel (Step 2 sidebar) reads this list to
// populate the Documents tab. Empty list = "TDS sheets pending; upload
// via /admin".

import { prisma } from "@/lib/prisma";

export type SportTdsFile = {
  name: string; // display label, e.g. "Football turf 40mm - TDS"
  url: string; // Vercel Blob URL to the PDF
  uploadedAt: string; // ISO timestamp
};

function keyFor(sport: string): string {
  return `sport_tds_${sport}_files`;
}

export async function getTdsFilesForSport(
  sport: string,
): Promise<SportTdsFile[]> {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: keyFor(sport) },
    });
    if (!row) return [];
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is SportTdsFile =>
        typeof f?.name === "string" && typeof f?.url === "string",
    );
  } catch (err) {
    console.error("[sport-tds] read failed", sport, err);
    return [];
  }
}

export async function setTdsFilesForSport(
  sport: string,
  files: SportTdsFile[],
): Promise<void> {
  await prisma.setting.upsert({
    where: { key: keyFor(sport) },
    create: { key: keyFor(sport), value: JSON.stringify(files) },
    update: { value: JSON.stringify(files) },
  });
}

export async function appendTdsFileForSport(
  sport: string,
  file: SportTdsFile,
): Promise<SportTdsFile[]> {
  const existing = await getTdsFilesForSport(sport);
  const next = [...existing, file];
  await setTdsFilesForSport(sport, next);
  return next;
}

export async function removeTdsFileForSport(
  sport: string,
  url: string,
): Promise<SportTdsFile[]> {
  const existing = await getTdsFilesForSport(sport);
  const next = existing.filter((f) => f.url !== url);
  await setTdsFilesForSport(sport, next);
  return next;
}
