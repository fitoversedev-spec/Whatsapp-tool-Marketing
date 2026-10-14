import { NextRequest, NextResponse } from "next/server";
import { APPROVAL_TABS, listApprovalCards, type ApprovalTab } from "@/lib/agent/approvalView";
import { getApproverOrStatus } from "@/lib/agent/approverAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The AI's approval requests, for the people who decide them (cookie sign-in).
//   GET ?status=pending|approved|rejected|expired   (default pending)
export async function GET(req: NextRequest) {
  const auth = await getApproverOrStatus();
  if ("status" in auth) {
    return NextResponse.json({ error: auth.status === 401 ? "Please sign in." : "You are not allowed to see this." }, { status: auth.status });
  }
  const raw = req.nextUrl.searchParams.get("status") ?? "pending";
  const tab: ApprovalTab = (APPROVAL_TABS as readonly string[]).includes(raw) ? (raw as ApprovalTab) : "pending";
  const { items, pendingCount } = await listApprovalCards(tab);
  return NextResponse.json({ status: tab, items, pendingCount });
}
