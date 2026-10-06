import { NextResponse } from "next/server";

// Retired: deals are confirmed projects, created only with "Won" on a customer
// (POST /api/account-contacts/[id]/won). Product interest is saved on the customer (/api/account-contacts/[id]/product-interests).
export async function POST() {
  return NextResponse.json({ error: "This action is no longer available — deals are created by marking a customer Won" }, { status: 410 });
}
