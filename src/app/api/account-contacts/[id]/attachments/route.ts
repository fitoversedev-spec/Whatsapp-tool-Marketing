// Documents uploaded against a contact — one place for everything tied to
// that person (ID proofs, signed agreements, site photos, etc.), visible
// to the owning rep and admin alike. Same upload mechanism as the general
// media library (uploadToBlob + categorize/MAX_SIZE), just recorded
// against AccountContactAttachment instead of Media.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { categorize, MAX_SIZE, uploadToBlob } from "@/lib/media";
import { blobFileName, readUploadForm, takeBlobField } from "@/lib/blob-policy";
import { loadContactForUser } from "@/lib/crm/contactAccess";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadContactForUser(params.id, user, "view");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const attachments = await prisma.accountContactAttachment.findMany({
    where: { accountContactId: params.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { name: true } } },
  });
  return NextResponse.json({ attachments });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadContactForUser(params.id, user, "edit");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  let form: FormData;
  try {
    form = await readUploadForm(req);
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  // Large files arrive as a Blob URL (browser uploaded them straight to Blob);
  // the multipart `file` path stays for tabs opened before this change.
  let url: string;
  let fileName: string;
  let fileSize: number;
  let mimeType: string;

  const ref = await takeBlobField(form, "blobUrl", "contact");
  if (ref) {
    if (!ref.ok) return NextResponse.json({ error: ref.error }, { status: ref.status });
    url = ref.blob.url;
    fileName = blobFileName(form, ref.blob);
    fileSize = ref.blob.size;
    mimeType = ref.blob.contentType;
  } else {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
    }

    const cat = categorize(file.type);
    if (file.size > MAX_SIZE[cat]) {
      const limitMb = (MAX_SIZE[cat] / 1024 / 1024).toFixed(0);
      return NextResponse.json({ error: `File too large. Max ${limitMb}MB for ${cat} files.` }, { status: 413 });
    }

    try {
      const uploaded = await uploadToBlob({
        bytes: file,
        fileName: file.name,
        mimeType: file.type,
        folder: "contact-attachments",
      });
      url = uploaded.url;
    } catch (err: any) {
      return NextResponse.json({ error: err?.message ?? "upload failed" }, { status: 500 });
    }
    fileName = file.name;
    fileSize = file.size;
    mimeType = file.type;
  }

  const attachment = await prisma.accountContactAttachment.create({
    data: {
      accountContactId: params.id,
      uploadedByUserId: user.id,
      fileName,
      fileUrl: url,
      fileSize,
      mimeType,
    },
    include: { uploadedBy: { select: { name: true } } },
  });
  return NextResponse.json({ attachment });
}
