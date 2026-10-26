import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listAiChats } from "@/lib/ai-chats/query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET ?q=: WhatsApp chats the AI Sales Agent handled, with hot / warm / cold labels.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.slice(0, 100) ?? undefined;
  return NextResponse.json(await listAiChats(user, { q }));
}
