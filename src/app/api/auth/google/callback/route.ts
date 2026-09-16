import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { Role } from "@/lib/rbac";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ??
  "https://whatsapp-tool-marketing.vercel.app";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam || !code) {
    return NextResponse.redirect(
      `${BASE_URL}/login?error=${encodeURIComponent(errorParam || "Google login cancelled")}`
    );
  }

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${BASE_URL}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("Google token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(
        `${BASE_URL}/login?error=${encodeURIComponent("Google login failed")}`
      );
    }

    const tokens = (await tokenRes.json()) as { access_token: string };

    // Get user info from Google
    const userInfoRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    if (!userInfoRes.ok) {
      console.error("Google userinfo failed:", await userInfoRes.text());
      return NextResponse.redirect(
        `${BASE_URL}/login?error=${encodeURIComponent("Could not fetch Google profile")}`
      );
    }

    const profile = (await userInfoRes.json()) as {
      email: string;
      name?: string;
      picture?: string;
    };

    const email = profile.email.toLowerCase();

    // Look up user by email
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // User exists -- check status
      if (user.deletedAt) {
        return NextResponse.redirect(
          `${BASE_URL}/login?error=${encodeURIComponent("This account has been removed. Contact an admin if you need access restored.")}`
        );
      }
      if (user.approvalStatus === "pending") {
        return NextResponse.redirect(`${BASE_URL}/login?code=pending`);
      }
      if (user.approvalStatus === "rejected") {
        return NextResponse.redirect(
          `${BASE_URL}/login?error=${encodeURIComponent("Your access has been declined.")}`
        );
      }
      if (!user.isActive) {
        return NextResponse.redirect(
          `${BASE_URL}/login?error=${encodeURIComponent("Your account has been deactivated. Please contact an admin.")}`
        );
      }

      // User is approved and active -- create session
      const session = await getSession();
      session.userId = user.id;
      session.email = user.email;
      session.name = user.name;
      session.role = user.role as Role;
      await session.save();

      // Usage tracking (same pattern as login route)
      try {
        await prisma.$executeRaw`UPDATE user_sessions SET ended_at = last_seen_at WHERE user_id = ${user.id} AND ended_at IS NULL`;
        await prisma.userSession.create({ data: { userId: user.id } });
      } catch {
        /* usage tracking must never block login */
      }

      return NextResponse.redirect(`${BASE_URL}/inbox`);
    }

    // User does not exist -- create with pending approval
    const randomPassword = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(randomPassword, 10);

    await prisma.user.create({
      data: {
        email,
        name: profile.name ?? email.split("@")[0],
        passwordHash,
        role: "sales",
        approvalStatus: "pending",
        isActive: true,
      },
    });

    return NextResponse.redirect(`${BASE_URL}/login?code=pending`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(
      `${BASE_URL}/login?error=${encodeURIComponent("Google login failed. Please try again.")}`
    );
  }
}
