// Hands the browser a short-lived Vercel Blob client token so large files go
// straight to Blob instead of through a function (Hobby caps request bodies at
// 4.5 MB). The browser (src/lib/blob-client.ts) declares {purpose, contentType,
// size}; we check the user + rules for that purpose and lock the token to that
// type, size cap and folder. No onUploadCompleted callback: the route that
// records the file re-checks the blob itself (verifyBlob).

import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/lib/auth";
import { BLOB_FOLDER } from "@/lib/blob-rules";
import { checkRules, parsePayload, roleAllowed } from "@/lib/blob-policy";

export const runtime = "nodejs";

class Refused extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function authorize(user: { role: string }, clientPayload: unknown, pathname?: string) {
  const p = parsePayload(clientPayload);
  if (!p) throw new Refused(400, "Bad upload request");
  if (!roleAllowed(p.purpose, user.role)) throw new Refused(403, "forbidden");
  if (pathname !== undefined) {
    const ok =
      pathname.startsWith(BLOB_FOLDER[p.purpose] + "/") && !pathname.includes("..") && pathname.length <= 200;
    if (!ok) throw new Refused(400, "Bad upload path");
  }
  const rules = await checkRules(p.purpose, p.contentType, p.size, p.headerType);
  if (!rules.ok) throw new Refused(rules.status, rules.error);
  return rules.limits;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as (HandleUploadBody | { type: "upload.check"; clientPayload?: string }) | null;
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  try {
    // The Blob client swallows the reason a token was refused, so the helper
    // asks for it here (same checks, no token issued).
    if (body.type === "upload.check") {
      await authorize(user, body.clientPayload);
      return NextResponse.json({ ok: true });
    }

    const result = await handleUpload({
      request: req,
      body: body as HandleUploadBody,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const limits = await authorize(user, clientPayload, pathname);
        return {
          allowedContentTypes: limits.allowedContentTypes,
          maximumSizeInBytes: limits.maximumSizeInBytes,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Refused) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: (err as Error)?.message ?? "upload failed" }, { status: 400 });
  }
}
