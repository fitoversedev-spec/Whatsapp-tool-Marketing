// Documents uploaded against a contact — one place for everything tied to
// that person (ID proofs, signed agreements, site photos, etc.), visible
// to the owning rep and admin alike. Same upload mechanism as the general
// media library (uploadToBlob + categorize/MAX_SIZE), just recorded
// against AccountContactAttachment instead of Media.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { categorize, MAX_SIZE, uploadToBlob } from "@/lib/media";

export const runtime = "nodejs";
export const maxDuration = 60;

async function loadAuthorized(id: string, userId: string, role: string) {
  const contact = await prisma.accountContact.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, account: { select: { ownerUserId: true } } },
  });
  if (!contact || contact.deletedAt) return { error: "not_found" as const, status: 404 };
  if (!isAdmin(role) && contact.account.ownerUserId && contact.account.ownerUserId !== userId) {
    return { error: "forbidden" as const, status: 403 };
  }
  return { contact };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const attachments = await prisma.accountContactAttachment.findMany({
    where: { accountContactId: params.id },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { name: true } } },
  });
  return NextResponse.json({ attachments });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }

  const cat = categorize(file.type);
  if (file.size > MAX_SIZE[cat]) {
    const limitMb = (MAX_SIZE[cat] / 1024 / 1024).toFixed(0);
    return NextResponse.json({ error: `File too large. Max ${limitMb}MB for ${cat} files.` }, { status: 413 });
  }

  let url: string;
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

  const attachment = await prisma.accountContactAttachment.create({
    data: {
      accountContactId: params.id,
      uploadedByUserId: user.id,
      fileName: file.name,
      fileUrl: url,
      fileSize: file.size,
      mimeType: file.type,
    },
    include: { uploadedBy: { select: { name: true } } },
  });
  return NextResponse.json({ attachment });
}
