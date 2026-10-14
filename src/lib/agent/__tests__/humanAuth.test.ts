import { beforeEach, describe, expect, it, vi } from "vitest";

// The AI agent's service account must never become a human session.
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...a: unknown[]) => getSession(...a) }));

const userFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    userSession: { create: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

const bcryptCompare = vi.fn();
vi.mock("bcryptjs", () => ({
  default: { compare: (...a: unknown[]) => bcryptCompare(...a), hash: vi.fn() },
}));

import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { POST as login } from "@/app/api/auth/login/route";

const baseUser = {
  id: "u1",
  email: "someone@example.com",
  name: "Someone",
  passwordHash: "hash",
  approvalStatus: "approved",
  isActive: true,
  deletedAt: null,
  rejectionReason: null,
};

beforeEach(() => {
  getSession.mockReset();
  userFindUnique.mockReset();
  bcryptCompare.mockReset();
});

describe("getCurrentUser", () => {
  it("returns a normal approved user", async () => {
    getSession.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ ...baseUser, role: "sales" });
    expect((await getCurrentUser())?.id).toBe("u1");
  });

  it("returns null for the ai_agent role, even with a valid-looking session", async () => {
    getSession.mockResolvedValue({ userId: "u1" });
    userFindUnique.mockResolvedValue({ ...baseUser, role: "ai_agent" });
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("POST /api/auth/login", () => {
  const request = () =>
    new NextRequest("https://app.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ai-sales-agent@service.fitoverse.invalid", password: "anything" }),
    });

  it("refuses the ai_agent role with the same answer as a wrong password, before checking the password", async () => {
    userFindUnique.mockResolvedValue({ ...baseUser, role: "ai_agent", passwordHash: "!disabled-service-account" });
    bcryptCompare.mockResolvedValue(true);
    const res = await login(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid email or password" });
    expect(bcryptCompare).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("still signs a normal user in (control)", async () => {
    userFindUnique.mockResolvedValue({ ...baseUser, role: "sales" });
    bcryptCompare.mockResolvedValue(true);
    getSession.mockResolvedValue({ save: vi.fn() });
    const res = await login(request());
    expect(res.status).toBe(200);
    expect(getSession).toHaveBeenCalled();
  });
});
