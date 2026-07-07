// PUBLIC interactive 3D viewer — no auth. The customer opens this link
// (sent over WhatsApp) and can drag to rotate / scroll to zoom the 3D
// court, instead of only seeing a static image.
//
// This route lives OUTSIDE the (dashboard) group so it isn't gated by
// requireUser(). The design id (an unguessable uuid) is the access
// token — only someone with the link can view that specific design.

import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import CourtViewerClient from "./CourtViewerClient";
import type { CourtLayout } from "@/lib/court-image/schema";

export const dynamic = "force-dynamic";

export default async function CourtViewerPage({
  params,
}: {
  params: { id: string };
}) {
  const row = await prisma.courtImage.findUnique({
    where: { id: params.id },
    select: { layout: true, customerName: true, number: true },
  });
  if (!row) notFound();

  let layout: CourtLayout;
  try {
    layout = JSON.parse(row.layout) as CourtLayout;
  } catch {
    notFound();
  }

  return (
    <CourtViewerClient
      layout={layout}
      customerName={row.customerName}
      number={row.number}
    />
  );
}
