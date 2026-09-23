import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInsightLink } from "@/lib/insights/signing";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { searchParams } = req.nextUrl;
  const e = Number(searchParams.get("e"));
  const s = searchParams.get("s") ?? "";

  const check = verifyInsightLink(params.id, e, s);
  if (!check.ok) {
    return new NextResponse(check.reason === "expired" ? "Link expired" : "Invalid link", {
      status: check.reason === "expired" ? 410 : 404,
    });
  }

  const doc = await prisma.insightDocument.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) {
    return new NextResponse("Not found", { status: 404 });
  }

  const pdf = await prisma.insightPdf.findUnique({
    where: { documentId: doc.id },
    select: { data: true, byteSize: true },
  });
  if (!pdf) {
    return new NextResponse("PDF not yet generated", { status: 404 });
  }

  const filename = (doc.title.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Insight") + ".pdf";
  return new NextResponse(pdf.data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": String(pdf.byteSize),
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
