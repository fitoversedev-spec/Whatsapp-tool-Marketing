import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getConnectionStatus } from "@/lib/meta-connection";

// Pulls every template Meta knows about for this WABA and upserts them into the
// local templates table. Maps Meta status (APPROVED/PENDING/REJECTED/...) to ours.
export async function POST() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const status = await getConnectionStatus();
  if (!status.configured) return NextResponse.json({ error: "Meta not configured" }, { status: 422 });
  if (!status.templates) {
    return NextResponse.json({ error: "Could not fetch templates from Meta" }, { status: 502 });
  }

  let added = 0;
  let updated = 0;
  for (const t of status.templates) {
    const mappedStatus =
      t.status === "APPROVED"
        ? "approved"
        : t.status === "REJECTED"
        ? "rejected"
        : t.status === "PAUSED"
        ? "paused"
        : t.status === "PENDING"
        ? "submitted"
        : "submitted";

    const existing = await prisma.template.findUnique({
      where: { metaTemplateId: t.metaTemplateId },
    });

    if (existing) {
      await prisma.template.update({
        where: { id: existing.id },
        data: {
          status: mappedStatus,
          body: t.body ?? existing.body,
          category: t.category,
          language: t.language,
        },
      });
      updated++;
    } else {
      await prisma.template.create({
        data: {
          name: t.name,
          language: t.language,
          category: t.category,
          body: t.body ?? "",
          status: mappedStatus,
          metaTemplateId: t.metaTemplateId,
          draftedByUserId: me.id,
          approvedByUserId: mappedStatus === "approved" ? me.id : null,
          submittedAt: new Date(),
        },
      });
      added++;
    }
  }

  return NextResponse.json({ added, updated, total: status.templates.length });
}
