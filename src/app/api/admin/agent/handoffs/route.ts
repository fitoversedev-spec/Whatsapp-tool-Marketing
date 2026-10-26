import { NextRequest, NextResponse } from "next/server";
import { countPendingHandoffs, listAssignees, listHandoffCards } from "@/lib/agent/handoffs/admin";
import { isHandoffStatus } from "@/lib/agent/handoffs/logic";
import { getHandoffViewer } from "@/lib/agent/handoffs/viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET ?status=PENDING|APPROVED|REJECTED|RELEASED: the AI → human handoff requests.
export async function GET(req: NextRequest) {
  const viewer = await getHandoffViewer();
  if (!viewer) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const raw = (req.nextUrl.searchParams.get("status") ?? "PENDING").toUpperCase();
  if (!isHandoffStatus(raw)) return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  const [items, pendingCount, assignees] = await Promise.all([
    listHandoffCards(viewer, raw),
    viewer.approver ? countPendingHandoffs() : Promise.resolve(0),
    viewer.approver ? listAssignees() : Promise.resolve([]),
  ]);
  return NextResponse.json({ items, pendingCount, assignees, approver: viewer.approver });
}
