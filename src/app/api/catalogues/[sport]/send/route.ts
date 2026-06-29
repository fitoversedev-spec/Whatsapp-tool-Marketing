// Send a sport catalogue to a WhatsApp customer. Sends the PDF first
// (with caption), then up to N hero photos as additional messages so
// the customer's chat shows: catalogue → project 1 photo → project 2
// photo → project 3 photo.
//
// Photos selected: hero photos of the same `featured` projects the
// catalogue PDF already includes, in the same order. We send a maximum
// of 3 by default to avoid spamming.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderCatalogue, type FeaturedProject } from "@/lib/catalogue/pdf";
import { getSportMeta, type SportKey } from "@/lib/catalogue/sport-meta";
import { uploadToBlob } from "@/lib/media";
import { sendMedia, describeMetaError } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  contactPhone: z.string().min(5).max(30),
  caption: z.string().max(1024).optional(),
  conversationId: z.string().uuid().nullable().optional(),
  maxPhotos: z.number().int().min(0).max(5).default(3),
});

export async function POST(req: NextRequest, { params }: { params: { sport: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const meta = getSportMeta(params.sport);
  if (!meta) {
    return NextResponse.json({ error: "unknown_sport" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { contactPhone, caption, conversationId, maxPhotos } = parsed.data;

  // Pull featured projects (same set that goes into the PDF) so the
  // photos we send afterwards match what the customer just saw on
  // page 3 of the catalogue.
  const featured = await prisma.portfolioProject.findMany({
    where: { sport: params.sport, featured: true, archived: false },
    orderBy: [{ completionDate: "desc" }, { createdAt: "desc" }],
    take: 6,
  });

  // 1. Render PDF + upload to blob
  let pdfUrl: string;
  const fileName = `fitoverse-${params.sport}-catalogue.pdf`;
  try {
    const projects: FeaturedProject[] = featured.map((p) => ({
      customerName: p.customerName,
      location: p.location,
      completionDate: p.completionDate,
      plotLengthFt: p.plotLengthFt,
      plotWidthFt: p.plotWidthFt,
      surfaceType: p.surfaceType,
      surfaceGrade: p.surfaceGrade,
      shortDescription: p.shortDescription,
      heroPhotoUrl: p.heroPhotoUrl,
    }));
    const pdfBuffer = await renderCatalogue(params.sport as SportKey, projects);
    const uploaded = await uploadToBlob({
      bytes: pdfBuffer,
      fileName,
      mimeType: "application/pdf",
      folder: "catalogues",
    });
    pdfUrl = uploaded.url;
  } catch (err) {
    console.error("[catalogue/send] PDF render/upload failed", err);
    return NextResponse.json(
      {
        error:
          "Failed to render catalogue PDF: " +
          (err instanceof Error ? err.message : String(err)),
      },
      { status: 500 }
    );
  }

  // 2. Send PDF over WhatsApp (with caption on the first message)
  const baseCaption =
    caption?.trim() ||
    `Fitoverse ${meta.label} catalogue. Reply with your plot size + location and we will send a custom quote.`;

  type Sent = { format: string; waMessageId: string; url: string };
  const sent: Sent[] = [];

  try {
    const r = await sendMedia({
      to: contactPhone,
      mediaType: "document",
      url: pdfUrl,
      caption: baseCaption,
      filename: fileName,
    });
    sent.push({ format: "catalogue-pdf", waMessageId: r.waMessageId, url: pdfUrl });
  } catch (err) {
    const e = describeMetaError(err);
    return NextResponse.json(
      { error: `WhatsApp send failed (catalogue PDF): ${e.message}`, code: e.code },
      { status: 502 }
    );
  }

  // 3. Send up to maxPhotos hero photos
  const heroPhotos = featured
    .filter((p) => p.heroPhotoUrl)
    .slice(0, maxPhotos);
  for (const p of heroPhotos) {
    if (!p.heroPhotoUrl) continue;
    try {
      const r = await sendMedia({
        to: contactPhone,
        mediaType: "image",
        url: p.heroPhotoUrl,
        caption: `${p.customerName}${p.location ? ` - ${p.location}` : ""}`,
      });
      sent.push({
        format: `project-photo:${p.id}`,
        waMessageId: r.waMessageId,
        url: p.heroPhotoUrl,
      });
    } catch (err) {
      // Don't abort the whole send if one photo fails — the catalogue
      // already landed. Log and continue.
      console.warn(
        `[catalogue/send] photo send failed for ${p.customerName}:`,
        err
      );
    }
  }

  // 4. Mirror everything into the linked conversation thread (if any)
  if (conversationId) {
    for (const s of sent) {
      const isPdf = s.format === "catalogue-pdf";
      await prisma.message
        .create({
          data: {
            conversationId,
            direction: "outbound",
            type: isPdf ? "document" : "image",
            body: isPdf
              ? `Catalogue: ${meta.label}`
              : `Past project photo (${meta.label})`,
            mediaUrl: s.url,
            mediaMimeType: isPdf ? "application/pdf" : "image/jpeg",
            mediaFileName: isPdf ? fileName : undefined,
            waMessageId: s.waMessageId,
            status: "sent",
            sentByUserId: user.id,
          },
        })
        .catch(() => null);
    }
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastOutboundAt: new Date() },
    });
  }

  return NextResponse.json({
    ok: true,
    sent: sent.length,
    sentDetails: sent,
  });
}
