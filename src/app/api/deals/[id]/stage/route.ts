import { NextResponse } from "next/server";

// Retired: deals are confirmed projects, created only with "Won" on a customer
// (POST /api/account-contacts/[id]/won). Deals don't move between stages.
export async function POST() {
  return NextResponse.json({ error: "This action is no longer available — deals are created by marking a customer Won" }, { status: 410 });
}
