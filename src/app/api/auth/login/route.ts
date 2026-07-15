import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { Role } from "@/lib/rbac";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });

  // Deleted accounts are blocked, even if previously approved.
  if (user.deletedAt) {
    return NextResponse.json(
      { error: "This account has been removed. Contact an admin if you need access restored.", code: "deleted" },
      { status: 403 }
    );
  }

  // Approval gate
  if (user.approvalStatus === "pending") {
    return NextResponse.json(
      { error: "Your account is awaiting admin approval.", code: "pending" },
      { status: 403 }
    );
  }
  if (user.approvalStatus === "rejected") {
    const reason = user.rejectionReason ? ` Reason: ${user.rejectionReason}` : "";
    return NextResponse.json(
      { error: `Your access has been declined.${reason}`, code: "rejected" },
      { status: 403 }
    );
  }
  if (!user.isActive) {
    return NextResponse.json(
      { error: "Your account has been deactivated. Please contact an admin.", code: "inactive" },
      { status: 403 }
    );
  }

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.name = user.name;
  session.role = user.role as Role;
  await session.save();

  return NextResponse.json({ ok: true, user: { email: user.email, name: user.name, role: user.role as Role } });
}
