import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { readSheet } from "@/lib/sheets";

const schema = z.object({
  sheetUrl: z.string().min(10),
  sheetRange: z.string().min(1).optional(),
});

// Reads a Google Sheet (header row + data) and returns the raw rows.
// The client then runs the same column analyzer used for file uploads.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  try {
    const rows = await readSheet({
      sheetUrlOrId: parsed.data.sheetUrl,
      range: parsed.data.sheetRange || "Sheet1",
    });
    if (!rows || rows.length < 2) {
      return NextResponse.json(
        { error: "Sheet needs a header row plus at least one contact row." },
        { status: 422 }
      );
    }
    return NextResponse.json({ rows, rowCount: rows.length - 1 });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Could not read sheet: ${err?.message ?? "unknown error"}` },
      { status: 502 }
    );
  }
}
