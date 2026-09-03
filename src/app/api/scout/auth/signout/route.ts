import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
