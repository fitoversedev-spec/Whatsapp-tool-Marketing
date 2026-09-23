import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  signInsightLink,
  signInsightPdfLink,
} from "@/lib/insights/signing";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const doc = await prisma.insightDocument.findUnique({
    where: { id: params.id },
  });
  if (!doc || doc.deletedAt || doc.authorId !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: { action: string; to?: string; caption?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { action } = body;

  if (action === "link") {
    const link = signInsightLink(doc.id);
    return NextResponse.json({
      url: link.fullUrl,
      expiresAt: link.expiresAt.toISOString(),
    });
  }

  if (action === "download") {
    const { renderInsightPdf } = await import("@/lib/insights/pdf");
    const pdfBytes = await renderInsightPdf(doc.title, doc.body);

    const pdfData = new Uint8Array(pdfBytes);
    await prisma.insightPdf.upsert({
      where: { documentId: doc.id },
      create: { documentId: doc.id, data: pdfData, byteSize: pdfData.length },
      update: { data: pdfData, byteSize: pdfData.length },
    });

    return new Response(pdfData, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(doc.title)}.pdf"`,
        "Content-Length": String(pdfData.length),
      },
    });
  }

  if (action === "whatsapp") {
    const to = body.to?.replace(/[^0-9]/g, "");
    if (!to || to.length < 10) {
      return NextResponse.json(
        { error: "invalid_phone" },
        { status: 400 },
      );
    }

    const { renderInsightPdf } = await import("@/lib/insights/pdf");
    const pdfBytes = await renderInsightPdf(doc.title, doc.body);

    const waPdfData = new Uint8Array(pdfBytes);
    await prisma.insightPdf.upsert({
      where: { documentId: doc.id },
      create: { documentId: doc.id, data: waPdfData, byteSize: waPdfData.length },
      update: { data: waPdfData, byteSize: waPdfData.length },
    });

    const pdfUrl = signInsightPdfLink(doc.id);

    const { sendMedia, isMetaConfigured } = await import("@/lib/whatsapp");
    if (!isMetaConfigured()) {
      return NextResponse.json(
        { error: "whatsapp_not_configured" },
        { status: 503 },
      );
    }

    const { waMessageId } = await sendMedia({
      to,
      mediaType: "document",
      url: pdfUrl,
      caption: body.caption || `${doc.title} — Fitoverse CRM`,
      filename: `${sanitizeFilename(doc.title)}.pdf`,
    });

    return NextResponse.json({ sent: true, waMessageId });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Insight";
}
