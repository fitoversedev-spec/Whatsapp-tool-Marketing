import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { Role } from "./rbac";

export type SessionData = {
  userId?: string;
  email?: string;
  name?: string;
  role?: Role;
};

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "dev-only-replace-me-with-32-plus-chars-please",
  cookieName: "whatsapp_tool_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  },
};

export async function getSession() {
  return await getIronSession<SessionData>(cookies(), sessionOptions);
}
