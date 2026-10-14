import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  setting: { findUnique: vi.fn() },
  agentApprovalRequest: { updateMany: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  APPROVAL_TTL_MS,
  canApprove,
  DEFAULT_APPROVERS,
  expireStaleApprovals,
  isApprover,
  loadApproverConfig,
  parseApproverConfig,
  resetApproverCache,
  STUCK_APPROVAL_MS,
} from "../approvals";

const admin = { id: "u-admin", role: "admin" };
const sales = { id: "u-sales", role: "sales" };
const manager = { id: "u-mgr", role: "manager" };
const agent = { id: "u-agent", role: "ai_agent" };

beforeEach(() => {
  vi.clearAllMocks();
  resetApproverCache();
});

describe("who may approve", () => {
  it("defaults to admins only when nothing is set, or the setting is unusable", () => {
    for (const raw of [undefined, null, "", "not json", "[]", "42", '{"roles":[],"userIds":[]}', '{"roles":"admin"}']) {
      expect(parseApproverConfig(raw)).toEqual(DEFAULT_APPROVERS);
    }
    expect(canApprove(admin, parseApproverConfig(undefined))).toBe(true);
    expect(canApprove(manager, parseApproverConfig(undefined))).toBe(false);
    expect(canApprove(sales, parseApproverConfig(undefined))).toBe(false);
  });

  it("honours listed roles and listed people", () => {
    const cfg = parseApproverConfig('{"roles":["manager"],"userIds":["u-sales"]}');
    expect(canApprove(manager, cfg)).toBe(true);
    expect(canApprove(sales, cfg)).toBe(true);
    expect(canApprove(admin, cfg)).toBe(false); // the owner chose; admins are not added behind their back
    expect(canApprove({ id: "someone-else", role: "sales" }, cfg)).toBe(false);
  });

  it("the ai_agent role can never approve, however it is listed", () => {
    const cfg = parseApproverConfig({ roles: ["ai_agent", "admin"], userIds: ["u-agent"] });
    expect(cfg.roles).toEqual(["admin"]);
    expect(canApprove(agent, cfg)).toBe(false);
    expect(canApprove(agent, { roles: ["ai_agent"], userIds: ["u-agent"] })).toBe(false);
    expect(canApprove(null, cfg)).toBe(false);
    expect(canApprove(undefined, cfg)).toBe(false);
  });

  it("reads the setting from the database and caches it briefly", async () => {
    db.setting.findUnique.mockResolvedValue({ key: "agent_approvers", value: '{"roles":["manager"],"userIds":[]}' });
    expect(await isApprover(manager)).toBe(true);
    expect(await isApprover(admin)).toBe(false);
    expect(await isApprover(agent)).toBe(false);
    expect(db.setting.findUnique).toHaveBeenCalledTimes(1);
    expect(db.setting.findUnique).toHaveBeenCalledWith({ where: { key: "agent_approvers" } });
    resetApproverCache();
    db.setting.findUnique.mockResolvedValue(null);
    expect(await loadApproverConfig()).toEqual(DEFAULT_APPROVERS);
    expect(await isApprover(admin)).toBe(true);
  });
});

describe("expiry", () => {
  it("requests live for 72 hours", () => {
    expect(APPROVAL_TTL_MS).toBe(72 * 60 * 60 * 1000);
  });

  it("the sweep turns overdue pending requests into expired and closes stuck approvals", async () => {
    const now = new Date("2026-10-13T10:00:00Z");
    db.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 1 });
    expect(await expireStaleApprovals(now)).toEqual({ expired: 3, closed: 1 });

    const [expireCall, stuckCall] = db.agentApprovalRequest.updateMany.mock.calls.map((c) => c[0]);
    expect(expireCall.where).toEqual({ status: "pending", expiresAt: { lte: now } });
    expect(expireCall.data).toMatchObject({ status: "expired" });
    // only approved rows that never recorded an outcome, and only after a grace period
    expect(stuckCall.where).toMatchObject({ status: "approved", executedAt: null, failureReason: null });
    expect(stuckCall.where.decidedAt).toEqual({ lt: new Date(now.getTime() - STUCK_APPROVAL_MS) });
    expect(stuckCall.data.status).toBe("failed");
  });
});
