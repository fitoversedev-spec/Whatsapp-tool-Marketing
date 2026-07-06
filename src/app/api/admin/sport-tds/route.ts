// Admin API for the per-sport TDS PDF bucket.
//
// GET  ?sport=<key>              → list current TDS files for that sport
// POST { sport, name, file }     → upload a PDF to Vercel Blob and
//                                   append to the sport's list
// DELETE ?sport=<key>&url=<url>  → remove a file from the sport's list
//
// Admin role only. Sport keys mirror the SportKey union — no validation
// beyond a length check because sports evolve; anything the sport-tds
// lib doesn't recognise is stored as-is and simply returns [] on read.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadToBlob } from "@/lib/media";
import {
  getTdsFilesForSport,
  appendTdsFileForSport,
  removeTdsFileForSport,
} from "@/lib/court-image/sport-tds";

function badSport(sport: string | null): sport is null {
  return !sport || sport.length < 3 || sport.length > 40;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sport = req.nextUrl.searchParams.get("sport");
  if (badSport(sport)) {
    return NextResponse.json({ error: "sport_required" }, { status: 400 });
  }
  const files = await getTdsFilesForSport(sport);
  return NextResponse.json({ sport, files });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }
  const sport = String(form.get("sport") ?? "");
  const displayName = String(form.get("name") ?? "").trim();
  const file = form.get("file");
  if (badSport(sport)) {
    return NextResponse.json({ error: "sport_required" }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "pdf_only" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadToBlob({
    bytes,
    fileName: file.name,
    mimeType: "application/pdf",
    folder: `sport-tds/${sport}`,
  });
  const files = await appendTdsFileForSport(sport, {
    name: displayName,
    url: uploaded.url,
    uploadedAt: new Date().toISOString(),
  });
  return NextResponse.json({ sport, files });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sport = req.nextUrl.searchParams.get("sport");
  const url = req.nextUrl.searchParams.get("url");
  if (badSport(sport)) {
    return NextResponse.json({ error: "sport_required" }, { status: 400 });
  }
  if (!url) {
    return NextResponse.json({ error: "url_required" }, { status: 400 });
  }
  const files = await removeTdsFileForSport(sport, url);
  return NextResponse.json({ sport, files });
}
