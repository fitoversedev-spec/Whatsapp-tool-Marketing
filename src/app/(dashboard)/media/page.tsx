import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import MediaLibraryClient from "./MediaLibraryClient";

export default async function MediaPage() {
  const user = await requireUser();

  const media = await prisma.media.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { uploadedBy: { select: { name: true } } },
  });

  // Aggregate total bytes for the storage stat
  const totalBytes = media.reduce((sum, m) => sum + m.size, 0);

  return (
    <MediaLibraryClient
      currentUserId={user.id}
      isAdmin={user.role === "admin"}
      initialMedia={media.map((m) => ({
        id: m.id,
        url: m.url,
        mimeType: m.mimeType,
        fileName: m.fileName,
        size: m.size,
        category: m.category,
        uploadedByName: m.uploadedBy.name,
        uploadedByUserId: m.uploadedByUserId,
        createdAt: m.createdAt.toISOString(),
      }))}
      totalBytes={totalBytes}
    />
  );
}
