// Upload a file into a team-chat thread. Mirrors the account-contacts
// attachments upload (uploadToBlob + categorize/MAX_SIZE) but stores to the
// private "chat" folder and returns only a REF — the ChatAttachment row is
// created together with the message (POST .../messages), so an abandoned
// upload never leaves an orphan row.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { categorize, MAX_SIZE, uploadToBlob } from "@/lib/media";
import { loadThreadAuthorized, type ChatAnchorType } from "@/lib/chat/access";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANCHOR_TYPES = ["account_contact", "deal", "team", "dm"] as const;
function parseAnchor(entityType: string): ChatAnchorType | null {
  return (ANCHOR_TYPES as readonly string[]).includes(entityType) ? (entityType as ChatAnchorType) : null;
}

export async function POST(req: NextRequest, { params }: { params: { entityType: string; entityId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const anchor = parseAnchor(params.entityType);
  if (!anchor) return NextResponse.json({ error: "bad_entity_type" }, { status: 400 });

  const res = await loadThreadAuthorized(anchor, params.entityId, { id: user.id, role: user.role as Role });
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

  try {
    const uploaded = await uploadToBlob({ bytes: file, fileName: file.name, mimeType: file.type, folder: "chat" });
    return NextResponse.json({
      ref: {
        fileName: file.name,
        fileUrl: uploaded.url,
        fileSize: file.size,
        mimeType: file.type,
        category: cat,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "upload failed" }, { status: 500 });
  }
}
