import { beforeEach, describe, expect, it, vi } from "vitest";

// The users admin API must not hand out, or take away, the ai_agent role.
const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getCurrentUser: (...a: unknown[]) => getCurrentUser(...a) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hash"), compare: vi.fn() } }));

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
      create: (...a: unknown[]) => userCreate(...a),
    },
  },
}));

import { NextRequest } from "next/server";
import { POST as createUser } from "@/app/api/users/route";
import { PATCH as patchUser } from "@/app/api/users/[id]/route";

const patch = (body: unknown) =>
  patchUser(
    new NextRequest("https://app.test/api/users/target", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id: "target" } },
  );

beforeEach(() => {
  getCurrentUser.mockReset();
  userFindUnique.mockReset();
  userUpdate.mockReset();
  userCreate.mockReset();
  getCurrentUser.mockResolvedValue({ id: "admin-1", role: "admin" });
});

describe("PATCH /api/users/[id]", () => {
  it("refuses to give anyone the ai_agent role", async () => {
    userFindUnique.mockResolvedValue({ role: "sales" });
    const res = await patch({ role: "ai_agent" });
    expect(res.status).toBe(403);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("refuses to change the role of the ai_agent service account", async () => {
    userFindUnique.mockResolvedValue({ role: "ai_agent" });
    const res = await patch({ role: "admin" });
    expect(res.status).toBe(403);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("still lets an admin change a normal user's role (control)", async () => {
    userFindUnique.mockResolvedValue({ role: "sales" });
    userUpdate.mockResolvedValue({});
    const res = await patch({ role: "manager" });
    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/users", () => {
  it("refuses to create a user with the ai_agent role", async () => {
    const res = await createUser(
      new NextRequest("https://app.test/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", email: "x@example.com", role: "ai_agent", password: "longenough1" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(userCreate).not.toHaveBeenCalled();
  });
});
