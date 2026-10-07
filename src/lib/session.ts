import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { Role } from "./rbac";

export type SessionData = {
  userId?: string;
  email?: string;
  name?: string;
  role?: Role;
  // When the login cookie was last (re)written — see keepSessionAlive.
  refreshedAt?: number;
};

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "dev-only-replace-me-with-32-plus-chars-please",
  cookieName: "whatsapp_tool_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    // 7 days from the last write — keepSessionAlive moves it forward while
    // the app is in use, so only 7 days without any use signs someone out.
    maxAge: 60 * 60 * 24 * 7,
  },
};

export async function getSession() {
  // Never sign live login cookies with the public development fallback.
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set");
  }
  return await getIronSession<SessionData>(cookies(), sessionOptions);
}

// Sliding sign-in: re-write the login cookie (a fresh 7 days) at most once a
// day while someone is using the app. Called from the badge poll
// (/api/unread/count), which runs every 30 s while the app is open — server
// pages can't write cookies in Next 14, route handlers can.
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export async function keepSessionAlive(): Promise<void> {
  const session = await getSession();
  if (!session.userId) return;
  if (session.refreshedAt && Date.now() - session.refreshedAt < REFRESH_AFTER_MS) return;
  session.refreshedAt = Date.now();
  await session.save();
}
