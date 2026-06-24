// Submit a template to Meta for approval.
//
// For media headers (IMAGE / VIDEO / DOCUMENT), Meta requires the sample
// asset to be uploaded through the Resumable Upload API first — supplying
// only a public URL in example.header_handle is no longer accepted and
// returns error_subcode 2388273 "Missing sample parameter for title type".
//
// The flow we implement:
//   1. Fetch the media bytes from the Vercel Blob URL stored in template.header
//   2. POST /{app-id}/uploads → returns an upload session id ("upload:...")
//   3. POST /{session-id} with the file binary → returns a handle ("4::..."")
//   4. Use that handle in components.example.header_handle when creating the
//      template
// Meta then reviews the template with the sample handle; once approved we can
// supply a different URL per message at send time.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitTemplate, describeMetaError } from "@/lib/whatsapp";
import { getMetaAccessToken } from "@/lib/token-manager";

// Resumable Upload API requires our App ID. Same env-driven pattern as
// token-manager.ts — defaults to original "Fito Marketing tool" for
// backwards compat, override via META_APP_ID when on a different app.
const APP_ID = process.env.META_APP_ID || "1460614352002830";
const API = process.env.META_GRAPH_API_VERSION || "v21.0";

async function uploadResumable(
  fileUrl: string,
  token: string
): Promise<{ handle: string }> {
  // 1. Fetch the source file from Vercel Blob (or wherever it's hosted)
  const fetched = await fetch(fileUrl);
  if (!fetched.ok) {
    throw new Error(
      `Failed to fetch source media from ${fileUrl}: ${fetched.status} ${fetched.statusText}`
    );
  }
  const contentType =
    fetched.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await fetched.arrayBuffer());
  const fileLength = buffer.length;
  const fileName = decodeURIComponent(fileUrl.split("/").pop() ?? "media");

  // 2. Initiate the upload session
  const initParams = new URLSearchParams({
    file_length: String(fileLength),
    file_type: contentType,
    file_name: fileName,
    access_token: token,
  });
  const initRes = await fetch(
    `https://graph.facebook.com/${API}/${APP_ID}/uploads?${initParams.toString()}`,
    { method: "POST" }
  );
  const initJson: any = await initRes.json();
  if (!initRes.ok || !initJson?.id) {
    throw new Error(
      `Resumable upload init failed: ${JSON.stringify(initJson)}`
    );
  }
  const sessionId: string = initJson.id; // e.g. "upload:MTo..."

  // 3. Upload the binary content. Meta wants OAuth-prefix auth (NOT Bearer)
  //    and `file_offset: 0` header for a single-shot upload.
  const uploadRes = await fetch(
    `https://graph.facebook.com/${API}/${sessionId}`,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${token}`,
        file_offset: "0",
      },
      body: buffer as any,
    }
  );
  const uploadJson: any = await uploadRes.json();
  if (!uploadRes.ok || !uploadJson?.h) {
    throw new Error(
      `Resumable upload binary failed: ${JSON.stringify(uploadJson)}`
    );
  }
  return { handle: uploadJson.h };
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const tpl = await prisma.template.findUnique({ where: { id: params.id } });
  if (!tpl) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (tpl.deletedAt) {
    return NextResponse.json({ error: "Template is deleted; restore it first" }, { status: 422 });
  }
  if (tpl.status !== "pending_admin") {
    return NextResponse.json(
      { error: "Only pending_admin templates can be submitted" },
      { status: 422 }
    );
  }

  // Build components in Meta format
  const components: Record<string, unknown>[] = [];

  if (tpl.header) {
    const h = JSON.parse(tpl.header) as
      | { format: "TEXT"; text: string }
      | { format: "IMAGE" | "VIDEO" | "DOCUMENT"; url: string; filename?: string };

    if (h.format === "TEXT") {
      components.push({ type: "HEADER", format: "TEXT", text: h.text });
    } else {
      // Resumable-upload the media to Meta and use the returned handle.
      let handle: string;
      try {
        const token = await getMetaAccessToken();
        const result = await uploadResumable(h.url, token);
        handle = result.handle;
      } catch (err: any) {
        return NextResponse.json(
          {
            error: `Media upload to Meta failed: ${err?.message ?? "unknown"}`,
          },
          { status: 502 }
        );
      }
      components.push({
        type: "HEADER",
        format: h.format,
        example: { header_handle: [handle] },
      });
    }
  }

  components.push({ type: "BODY", text: tpl.body });
  if (tpl.footer) components.push({ type: "FOOTER", text: tpl.footer });
  if (tpl.buttons)
    components.push({ type: "BUTTONS", ...(JSON.parse(tpl.buttons) as any) });

  try {
    const result = await submitTemplate({
      name: tpl.name,
      language: tpl.language,
      category: tpl.category as "MARKETING" | "UTILITY" | "AUTHENTICATION",
      components,
    });

    await prisma.template.update({
      where: { id: tpl.id },
      data: {
        status: "submitted",
        metaTemplateId: result.id || null,
        approvedByUserId: user.id,
        submittedAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true, metaTemplateId: result.id });
  } catch (err) {
    const e = describeMetaError(err);
    return NextResponse.json(
      { error: `Meta rejected submission: ${e.message}`, code: e.code },
      { status: 502 }
    );
  }
}
