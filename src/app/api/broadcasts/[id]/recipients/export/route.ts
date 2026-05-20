import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const broadcast = await prisma.broadcast.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, createdByUserId: true },
  });
  if (!broadcast) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (me.role !== "admin" && broadcast.createdByUserId !== me.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const recipients = await prisma.broadcastRecipient.findMany({
    where: { broadcastId: broadcast.id },
    orderBy: [{ status: "asc" }, { phoneE164: "asc" }],
    select: {
      phoneE164: true,
      name: true,
      status: true,
      errorCode: true,
      errorMessage: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
    },
  });

  const header = ["phone", "name", "status", "sent_at", "delivered_at", "read_at", "error_code", "error_message"];
  const lines = [header.join(",")];
  for (const r of recipients) {
    lines.push(
      [
        r.phoneE164,
        r.name ?? "",
        r.status,
        r.sentAt?.toISOString() ?? "",
        r.deliveredAt?.toISOString() ?? "",
        r.readAt?.toISOString() ?? "",
        r.errorCode ?? "",
        r.errorMessage ?? "",
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const safeName = broadcast.name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
  const filename = `broadcast_${safeName}_${broadcast.id.slice(0, 8)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
