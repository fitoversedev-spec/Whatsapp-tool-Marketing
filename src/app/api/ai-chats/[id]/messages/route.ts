import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { chatTranscript, findVisibleChat } from "@/lib/ai-chats/query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: the last messages of one AI chat, labelled customer / ai / staff.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const convo = await findVisibleChat(user, params.id);
  if (!convo) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  return NextResponse.json({ messages: await chatTranscript(convo.id) });
}
