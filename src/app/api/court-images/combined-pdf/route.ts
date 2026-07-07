// Build the combined court-design PDF (2D + 3D + products + equipment +
// TDS + optional quote) and upload it to Blob. Returns { url } so the
// client can download it or send it over WhatsApp / email.
//
// POST JSON:
//   customerName, plotLabel, baseWork, flooringName, sports[]
//   image2d (dataURL), image3d? (dataURL)
//   attachments: { productIds, equipmentIds, tdsIds }
//   quote?: { number, items:[{name,total}], subtotal, gst, grandTotal }

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadToBlob } from "@/lib/media";
import { prisma } from "@/lib/prisma";
import { sendText, sendMedia } from "@/lib/whatsapp";
import {
  getProductsByIds,
  getTdsByIds,
  type ProductDTO,
} from "@/lib/products/store";
import {
  renderCombinedPdf,
  type CombinedPdfInput,
  type CombinedQuote,
} from "@/lib/court-image/combined-pdf";
import {
  getRatesForSport,
  SUPPORTED_SPORTS,
  type Sport,
} from "@/lib/quotation/rates";
import {
  buildInitialLineItems,
  recompute,
  buildQuotationNumber,
} from "@/lib/quotation/calculator";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";

export const runtime = "nodejs";
export const maxDuration = 60;

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!m) return null;
  return new Uint8Array(Buffer.from(m[1], "base64"));
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const designImages: CombinedPdfInput["designImages"] = [];
  if (typeof body.image2d === "string") {
    const bytes = dataUrlToBytes(body.image2d);
    if (bytes) designImages.push({ label: "2D court plan", bytes });
  }
  if (typeof body.image3d === "string") {
    const bytes = dataUrlToBytes(body.image3d);
    if (bytes) designImages.push({ label: "3D view", bytes });
  }

  const attachments = body.attachments ?? {
    productIds: [],
    equipmentIds: [],
    tdsIds: [],
  };
  const [flooringMaterials, equipment, tds] = await Promise.all([
    getProductsByIds(attachments.productIds ?? []),
    getProductsByIds(attachments.equipmentIds ?? []),
    getTdsByIds(attachments.tdsIds ?? []),
  ]);
  // Equipment IDs may have landed in productIds too — de-dup by type.
  const products: ProductDTO[] = flooringMaterials.filter(
    (p) => p.type !== "equipment",
  );

  // Optional quote — computed server-side from the sport's rate sheet
  // × plot area (same logic the Quotation wizard seeds with). Only when
  // includeQuote is on and we have plot dimensions.
  let quote: CombinedQuote | null = null;
  const sports: string[] = Array.isArray(body.sports) ? body.sports : [];
  const lengthFt = Number(body.lengthFt) || 0;
  const widthFt = Number(body.widthFt) || 0;
  if (body.includeQuote && lengthFt > 0 && widthFt > 0) {
    const primary = sports[0];
    const rateSport: Sport = SUPPORTED_SPORTS.includes(primary as Sport)
      ? (primary as Sport)
      : "multisport";
    const rates = await getRatesForSport(rateSport);
    const items = buildInitialLineItems(rates, lengthFt, widthFt);
    const totals = recompute(items);
    quote = {
      number: buildQuotationNumber(new Date().getFullYear(), 0),
      items: items
        .filter((it) => it.included)
        .map((it) => ({ name: it.name, total: it.areaSqFt * it.ratePerSqFt })),
      subtotal: totals.subtotal,
      gst: totals.gstAmount,
      grandTotal: totals.grandTotal,
    };
  }

  const input: CombinedPdfInput = {
    customerName: String(body.customerName ?? ""),
    plotLabel: String(body.plotLabel ?? ""),
    baseWork: body.baseWork ?? null,
    flooringName: body.flooringName ?? null,
    sports,
    designImages,
    products,
    equipment,
    tds,
    quote,
  };

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await renderCombinedPdf(input);
  } catch (err) {
    console.error("[combined-pdf] render failed", err);
    return NextResponse.json({ error: "render_failed" }, { status: 500 });
  }

  const uploaded = await uploadToBlob({
    bytes: Buffer.from(pdfBytes),
    fileName: `fitoverse-design-${Date.now()}.pdf`,
    mimeType: "application/pdf",
    folder: "combined-pdf",
  });

  // Optional send over WhatsApp as a document.
  let sent = false;
  if (body.send && typeof body.contactPhone === "string" && body.contactPhone) {
    try {
      const caption = `Fitoverse court design proposal for ${input.customerName || "your project"}.`;
      await sendText({ to: body.contactPhone, body: caption }).catch(() => null);
      await sendMedia({
        to: body.contactPhone,
        mediaType: "document",
        url: uploaded.url,
        caption,
        filename: "fitoverse-court-design.pdf",
      });
      sent = true;
      // Mirror into the conversation thread if we know it.
      if (typeof body.conversationId === "string" && body.conversationId) {
        await prisma.message
          .create({
            data: {
              conversationId: body.conversationId,
              direction: "outbound",
              type: "document",
              body: "[Combined PDF] court design proposal",
              mediaUrl: uploaded.url,
              status: "sent",
            },
          })
          .catch(() => null);
        await prisma.conversation
          .update({
            where: { id: body.conversationId },
            data: { lastOutboundAt: new Date() },
          })
          .catch(() => null);
      }
    } catch (err) {
      console.error("[combined-pdf] send failed", err);
    }
  }

  // Optional send by email as a PDF attachment.
  let emailed: boolean | "not_configured" = false;
  if (body.email && typeof body.email === "string") {
    if (!isEmailConfigured()) {
      emailed = "not_configured";
    } else {
      const res = await sendEmail({
        to: body.email,
        subject: `Fitoverse court design — ${input.customerName || "your project"}`,
        html: `<p>Hi,</p><p>Please find attached your Fitoverse court design proposal${
          input.plotLabel ? ` (${input.plotLabel})` : ""
        }.</p><p>You can also view it here: <a href="${uploaded.url}">${uploaded.url}</a></p><p>— Fitoverse</p>`,
        attachments: [
          {
            filename: "fitoverse-court-design.pdf",
            content: Buffer.from(pdfBytes).toString("base64"),
          },
        ],
      });
      emailed = res.sent;
    }
  }

  return NextResponse.json({ url: uploaded.url, sent, emailed });
}
