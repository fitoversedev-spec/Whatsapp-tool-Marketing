import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import InsightEditorClient from "@/app/(crm-app)/crm/insights/[id]/InsightEditorClient";

export default async function CampaignDocumentPage({
  params,
}: {
  params: { campaignId: string; docId: string };
}) {
  await requireUser();

  const doc = await prisma.insightDocument.findUnique({
    where: { id: params.docId },
  });
  if (!doc || doc.deletedAt || doc.campaignMetaId !== params.campaignId) notFound();

  return (
    <InsightEditorClient
      document={{
        id: doc.id,
        title: doc.title,
        body: doc.body,
        updatedAt: doc.updatedAt.toISOString(),
      }}
      backHref={`/ad-campaigns/${params.campaignId}`}
      backLabel="Back to campaign"
    />
  );
}
