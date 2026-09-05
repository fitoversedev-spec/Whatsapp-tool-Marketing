/**
 * `POST /api/scout/scans/{id}/archive` — soft-delete a scan.
 *
 * Sets `archived_at` rather than removing the row: the scan, its reports and
 * its usage log all stay intact for anything that still references them
 * directly (a shared report link, an admin audit), they just stop appearing
 * in the saved-scans lists. Gated by the same owner-or-admin check every
 * other scan sub-resource uses.
 */

import { NextResponse } from "next/server";

import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { prisma } from "@/lib/scout/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;

  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const scan = await prisma.scan.findUnique({ where: { id }, select: { ownerId: true } });
  // Someone else's scan is a 404, never a 403 — a 403 confirms the id exists.
  if (!scan || (scan.ownerId !== identity.userId && !canAccessAllScans(identity))) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  await prisma.scan.update({ where: { id }, data: { archivedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
