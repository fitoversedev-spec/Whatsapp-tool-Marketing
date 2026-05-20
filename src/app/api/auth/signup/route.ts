import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["admin", "sales"]),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { name, email, password, role } = parsed.data;
    const lowerEmail = email.toLowerCase();

    const existingUser = await prisma.user.findUnique({ where: { email: lowerEmail } });
    if (existingUser) {
      if (existingUser.deletedAt) {
        return NextResponse.json(
          { error: "This email belonged to a deleted account. Please contact an admin to restore access." },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: "Email is already registered" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        email: lowerEmail,
        name,
        passwordHash,
        role,
        approvalStatus: "pending", // <-- key change
        isActive: true,
      },
    });

    // Do NOT issue a session cookie. User must wait for admin approval.
    return NextResponse.json({
      ok: true,
      pending: true,
      message: "Account created. An admin will review your request shortly.",
    });
  } catch (error: any) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
