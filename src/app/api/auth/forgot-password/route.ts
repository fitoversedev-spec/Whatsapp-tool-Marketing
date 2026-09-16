import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sealData } from "iron-session";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";

const schema = z.object({
  email: z.string().email(),
});

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ??
  "https://whatsapp-tool-marketing.vercel.app";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Always return 200 to prevent email enumeration
  const ok200 = NextResponse.json({ ok: true });

  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });

    // Only send the email if the user exists, is not deleted, and is approved
    if (
      !user ||
      user.deletedAt ||
      user.approvalStatus !== "approved"
    ) {
      return ok200;
    }

    // Create a sealed token with userId and 1-hour expiry
    const token = await sealData(
      { userId: user.id, exp: Date.now() + 3600000 },
      { password: process.env.SESSION_SECRET! }
    );

    const resetLink = `${BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: user.email,
      subject: "Reset your Fitoverse password",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <h2 style="margin: 0 0 16px; font-size: 22px; color: #1e293b;">Password Reset</h2>
          <p style="color: #475569; line-height: 1.6; margin: 0 0 24px;">
            We received a request to reset the password for your Fitoverse account. Click the button below to set a new password:
          </p>
          <a href="${resetLink}" style="display: inline-block; background: #128C7E; color: white; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 600; font-size: 15px;">
            Reset Password
          </a>
          <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin: 24px 0 0;">
            This link expires in 1 hour. If you did not request this, you can safely ignore this email.
          </p>
        </div>
      `,
      text: `Reset your Fitoverse password by visiting: ${resetLink}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
    });
  } catch (err) {
    // Log server-side but never leak info to the client
    console.error("Forgot-password error:", err);
  }

  return ok200;
}
