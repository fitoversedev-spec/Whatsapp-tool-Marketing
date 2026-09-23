import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import InsightEditorClient from "./InsightEditorClient";

export default async function InsightEditorPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const doc = await prisma.insightDocument.findUnique({
    where: { id: params.id },
  });
  if (!doc || doc.deletedAt || doc.authorId !== user.id) notFound();

  return (
    <InsightEditorClient
      document={{
        id: doc.id,
        title: doc.title,
        body: doc.body,
        updatedAt: doc.updatedAt.toISOString(),
      }}
    />
  );
}
