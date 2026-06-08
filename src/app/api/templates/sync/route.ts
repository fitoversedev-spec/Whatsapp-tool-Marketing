// Reconcile our local Template rows with Meta's live state.
//
// Why this exists:
//   Normally, the `message_template_status_update` webhook auto-syncs
//   status changes (PENDING → APPROVED / REJECTED). But during the
//   2026-06-06..06-08 cross-business webhook outage (apps + WABA in
//   different Meta business portfolios), Meta sent approval events we
//   couldn't receive, and Meta gave up retrying. This endpoint lets an
//   admin manually sync any drift. It's also safe to run anytime — Meta
//   is the source of truth.
//
// Auth: admin only.
// Behavior: pulls all templates from Meta (paginated by metaTemplateId),
//   updates each matching DB row's status + rejectionReason. Rows whose
//   metaTemplateId is no longer present on Meta are marked "rejected"
//   with a reason "Template no longer exists on Meta (deleted)".

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMetaAccessToken } from "@/lib/token-manager";

const WABA = process.env.META_WABA_ID || "";
const API = process.env.META_GRAPH_API_VERSION || "v21.0";

export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!WABA) {
    return NextResponse.json({ error: "META_WABA_ID not configured" }, { status: 500 });
  }

  const token = await getMetaAccessToken();
  if (!token) {
    return NextResponse.json({ error: "No Meta access token" }, { status: 500 });
  }

  // Pull live state from Meta — handle pagination.
  const metaByMid = new Map<string, { status: string; rejected: string | null; name: string }>();
  let next: string | null =
    `https://graph.facebook.com/${API}/${WABA}/message_templates?fields=name,status,language,id,rejected_reason&limit=100`;

  try {
    while (next) {
      const r = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
      const data: any = await r.json();
      if (!r.ok) {
        return NextResponse.json(
          { error: `Meta API error: ${data?.error?.message ?? r.statusText}` },
          { status: 502 }
        );
      }
      for (const t of (data?.data ?? []) as Array<{
        id: string;
        name: string;
        status: string;
        rejected_reason?: string;
      }>) {
        metaByMid.set(t.id, {
          status: (t.status ?? "").toLowerCase(),
          rejected: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
          name: t.name,
        });
      }
      next = data?.paging?.next ?? null;
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to fetch Meta templates: ${err?.message ?? "unknown"}` },
      { status: 502 }
    );
  }

  const dbTemplates = await prisma.template.findMany({
    where: { metaTemplateId: { not: null } },
  });

  type ChangeRow = {
    id: string;
    name: string;
    metaTemplateId: string;
    oldStatus: string;
    newStatus: string;
    note?: string;
  };
  const changes: ChangeRow[] = [];
  const unchanged: { id: string; name: string; status: string }[] = [];

  for (const t of dbTemplates) {
    const mid = t.metaTemplateId!;
    const meta = metaByMid.get(mid);
    if (!meta) {
      // Stale: Meta no longer has this template
      if (t.status !== "rejected") {
        await prisma.template.update({
          where: { id: t.id },
          data: {
            status: "rejected",
            rejectionReason: "Template no longer exists on Meta (deleted)",
          },
        });
        changes.push({
          id: t.id,
          name: t.name,
          metaTemplateId: mid,
          oldStatus: t.status,
          newStatus: "rejected",
          note: "missing on Meta",
        });
      } else {
        unchanged.push({ id: t.id, name: t.name, status: t.status });
      }
      continue;
    }
    if (t.status === meta.status) {
      unchanged.push({ id: t.id, name: t.name, status: t.status });
      continue;
    }
    await prisma.template.update({
      where: { id: t.id },
      data: { status: meta.status, rejectionReason: meta.rejected },
    });
    changes.push({
      id: t.id,
      name: t.name,
      metaTemplateId: mid,
      oldStatus: t.status,
      newStatus: meta.status,
    });
  }

  return NextResponse.json({
    ok: true,
    metaTotal: metaByMid.size,
    dbTotal: dbTemplates.length,
    changed: changes.length,
    unchanged: unchanged.length,
    changes,
  });
}
