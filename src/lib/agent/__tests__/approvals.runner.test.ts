import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const state = vi.hoisted(() => ({ row: null as Row | null }));

const db = vi.hoisted(() => ({
  setting: { findUnique: vi.fn() },
  agentApprovalRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
  agentIdentity: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const executors = vi.hoisted(() => ({} as Record<string, (...a: any[]) => Promise<any>>));
vi.mock("../registry", () => ({ AREA_EXECUTORS: executors }));
const verdict = vi.hoisted(() => vi.fn());
vi.mock("../permissions", () => ({
  getEffectiveVerdict: (...a: unknown[]) => verdict(...a),
  // approve_quote is NEVER by design (only a person's approval runs it).
  TOOL_REGISTRY: {
    update_lead_phone: { default: "APPROVAL", action: "update" },
    approve_quote: { default: "NEVER", action: "update" },
  },
}));
const writeAgentAudit = vi.hoisted(() => vi.fn());
vi.mock("../audit", async () => {
  const actual = await vi.importActual<typeof import("../audit")>("../audit");
  return { ...actual, writeAgentAudit: (...a: unknown[]) => writeAgentAudit(...a) };
});

import { AgentHttpError } from "../errors";
import { approvalInputHash, resetApproverCache } from "../approvals";
import { approveRequest, rejectRequest } from "../approvalRunner";

const INPUT = { leadId: "lead-1", phone: "+919876543210", reason: "Customer gave a new number" };
const admin = { id: "u-admin", role: "admin" };

function makeRow(over: Row = {}): Row {
  return {
    id: "appr-1",
    identityId: "idn-1",
    correlationId: "corr-1234567",
    toolName: "update_lead_phone",
    inputJson: INPUT,
    inputHash: approvalInputHash("update_lead_phone", INPUT),
    summary: "update_lead_phone (leadId, phone, reason)",
    status: "pending",
    requestedAt: new Date(Date.now() - 3_600_000),
    expiresAt: new Date(Date.now() + 3_600_000),
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    executedAt: null,
    resultJson: null,
    failureReason: null,
    ...over,
  };
}

const lastAudit = () => writeAgentAudit.mock.calls.at(-1)![0] as Row;

beforeEach(() => {
  vi.clearAllMocks();
  resetApproverCache();
  for (const k of Object.keys(executors)) delete executors[k];
  state.row = makeRow();
  verdict.mockResolvedValue("APPROVAL");
  writeAgentAudit.mockResolvedValue({});
  db.setting.findUnique.mockResolvedValue(null); // admins only
  db.agentIdentity.findUnique.mockResolvedValue({ id: "idn-1", userId: "agent-user", status: "active" });
  db.agentApprovalRequest.findUnique.mockImplementation(async ({ where }: Row) =>
    state.row && state.row.id === where.id ? { ...state.row } : null,
  );
  // The WHERE clause is the lock, exactly like the real UPDATE ... WHERE.
  db.agentApprovalRequest.updateMany.mockImplementation(async ({ where, data }: Row) => {
    const r = state.row;
    if (!r || (where.id && r.id !== where.id)) return { count: 0 };
    if (where.status !== undefined && r.status !== where.status) return { count: 0 };
    if (where.expiresAt?.gt && !(r.expiresAt.getTime() > where.expiresAt.gt.getTime())) return { count: 0 };
    Object.assign(r, data);
    return { count: 1 };
  });
});

describe("tools that are NEVER for the AI by design", () => {
  it("runs approve_quote when a person approves it (NEVER by design is not 'switched off')", async () => {
    const quoteInput = { quotationId: "q-1", contentHash: "abc" };
    state.row = makeRow({ toolName: "approve_quote", inputJson: quoteInput, inputHash: approvalInputHash("approve_quote", quoteInput) });
    verdict.mockResolvedValue("NEVER");
    const run = vi.fn().mockResolvedValue({ status: 200, body: { approvalState: "approved" } });
    executors.approve_quote = run;
    const out = await approveRequest({ id: "appr-1", approver: admin, note: null });
    expect(out).toMatchObject({ ok: true, status: "executed" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("still blocks a tool an admin switched off after it was asked", async () => {
    verdict.mockResolvedValue("NEVER"); // update_lead_phone defaults to APPROVAL, so NEVER means an override
    const run = vi.fn();
    executors.update_lead_phone = run;
    const out = await approveRequest({ id: "appr-1", approver: admin, note: null });
    expect(out).toMatchObject({ status: "failed" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("approving runs the action once, with the stored input", () => {
  it("executes, stores the result and writes an audit row naming the approver", async () => {
    const run = vi.fn().mockResolvedValue({ status: 200, body: { changed: true }, recordIds: ["lead-1"] });
    executors.update_lead_phone = run;

    const out = await approveRequest({ id: "appr-1", approver: admin, note: "Looks right" });

    expect(out).toMatchObject({ ok: true, status: "executed", failureReason: null, result: { changed: true } });
    expect(run).toHaveBeenCalledTimes(1);
    const arg = run.mock.calls[0][0];
    expect(arg.input).toEqual(INPUT);
    expect(arg.approvalId).toBe("appr-1");
    expect(arg.approvedByUserId).toBe("u-admin");
    expect(arg.ctx).toMatchObject({ identityId: "idn-1", userId: "agent-user", correlationId: "corr-1234567" });

    expect(state.row).toMatchObject({
      status: "executed",
      decidedByUserId: "u-admin",
      decisionNote: "Looks right",
      resultJson: { changed: true },
      failureReason: null,
    });
    expect(state.row!.executedAt).toBeInstanceOf(Date);
    expect(state.row!.decidedAt).toBeInstanceOf(Date);

    expect(writeAgentAudit).toHaveBeenCalledTimes(1);
    expect(lastAudit()).toMatchObject({
      toolName: "update_lead_phone",
      approvalId: "appr-1",
      identityId: "idn-1",
      correlationId: "corr-1234567",
      action: "approval_executed",
      result: "success",
    });
    expect(lastAudit().recordIds).toEqual(expect.arrayContaining(["appr-1", "approver:u-admin", "lead-1"]));
  });

  it("a double click runs it once: the second click is told someone already decided", async () => {
    const run = vi.fn().mockResolvedValue({ status: 200, body: { ok: 1 } });
    executors.update_lead_phone = run;

    const [a, b] = await Promise.all([
      approveRequest({ id: "appr-1", approver: admin, note: null }),
      approveRequest({ id: "appr-1", approver: admin, note: null }),
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, code: "not_pending" });
    // and a later click after it finished is refused the same way
    expect(await approveRequest({ id: "appr-1", approver: admin, note: null })).toMatchObject({ ok: false, code: "not_pending" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never runs a request that was edited after the AI asked", async () => {
    const run = vi.fn();
    executors.update_lead_phone = run;
    state.row = makeRow({ inputJson: { ...INPUT, phone: "+919000000000" } }); // hash still matches the original

    const out = await approveRequest({ id: "appr-1", approver: admin, note: null });

    expect(run).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: true, status: "failed" });
    expect(state.row).toMatchObject({ status: "failed", executedAt: null });
    expect(state.row!.failureReason).toMatch(/no longer matches/);
    expect(lastAudit()).toMatchObject({ action: "approval_tampered", result: "error" });
  });

  it("with no executor for the tool it stays approved, says nothing was run, and runs nothing", async () => {
    state.row = makeRow({ toolName: "some_future_tool", inputHash: approvalInputHash("some_future_tool", INPUT) });

    const out = await approveRequest({ id: "appr-1", approver: admin, note: null });

    expect(out).toMatchObject({ ok: true, status: "approved" });
    expect(state.row).toMatchObject({ status: "approved", executedAt: null });
    expect(state.row!.failureReason).toMatch(/cannot be run automatically/);
    expect(lastAudit()).toMatchObject({ action: "approval_not_executable", toolName: "some_future_tool" });
  });

  it("a tool that is not an own property of the executor table (e.g. 'constructor') has no executor", async () => {
    state.row = makeRow({ toolName: "constructor", inputHash: approvalInputHash("constructor", INPUT) });
    const out = await approveRequest({ id: "appr-1", approver: admin, note: null });
    expect(out).toMatchObject({ ok: true, status: "approved" });
  });

  it("records a refusal from the executor as failed, with its message", async () => {
    executors.update_lead_phone = vi.fn().mockResolvedValue({
      status: 409,
      body: { error: { code: "invalid_input", message: "Another lead already has this number.", correlationId: "c" }, reason: "phone_in_use" },
    });
    const out = await approveRequest({ id: "appr-1", approver: admin, note: null });
    expect(out).toMatchObject({ ok: true, status: "failed" });
    expect(state.row!.failureReason).toBe("Another lead already has this number. (phone_in_use)");
    expect(state.row!.resultJson).toMatchObject({ reason: "phone_in_use" });
    expect(lastAudit()).toMatchObject({ action: "approval_refused", result: "error", httpStatus: 409 });
  });

  it("records thrown errors as failed without repeating the action", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new AgentHttpError("not_found", "Lead not found."))
      .mockRejectedValueOnce(new Error("db exploded: secret detail"));
    executors.update_lead_phone = run;

    expect(await approveRequest({ id: "appr-1", approver: admin, note: null })).toMatchObject({ status: "failed", failureReason: "Lead not found." });
    expect(run).toHaveBeenCalledTimes(1);

    state.row = makeRow();
    const out = await approveRequest({ id: "appr-1", approver: admin, note: null });
    expect(out).toMatchObject({ status: "failed" });
    expect((out as { failureReason: string }).failureReason).not.toMatch(/secret/);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not run a tool an admin has since switched off, or for an AI account that is no longer active", async () => {
    const run = vi.fn();
    executors.update_lead_phone = run;
    verdict.mockResolvedValue("NEVER");
    expect(await approveRequest({ id: "appr-1", approver: admin, note: null })).toMatchObject({ status: "failed" });

    verdict.mockResolvedValue("APPROVAL");
    state.row = makeRow();
    db.agentIdentity.findUnique.mockResolvedValue({ id: "idn-1", userId: "agent-user", status: "disabled" });
    expect(await approveRequest({ id: "appr-1", approver: admin, note: null })).toMatchObject({ status: "failed" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("only approvers, only pending, never expired, never the AI itself", () => {
  it("refuses people who are not approvers, and the ai_agent role, before touching the request", async () => {
    const run = vi.fn();
    executors.update_lead_phone = run;
    for (const approver of [{ id: "u-sales", role: "sales" }, { id: "u-mgr", role: "manager" }, { id: "agent-user", role: "ai_agent" }]) {
      expect(await approveRequest({ id: "appr-1", approver, note: null })).toMatchObject({ ok: false, code: "not_approver" });
      expect(await rejectRequest({ id: "appr-1", approver, note: "no" })).toMatchObject({ ok: false, code: "not_approver" });
    }
    expect(db.agentApprovalRequest.updateMany).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(state.row!.status).toBe("pending");
  });

  it("follows the agent_approvers setting", async () => {
    db.setting.findUnique.mockResolvedValue({ value: '{"roles":["manager"],"userIds":[]}' });
    executors.update_lead_phone = vi.fn().mockResolvedValue({ status: 200, body: {} });
    expect(await approveRequest({ id: "appr-1", approver: admin, note: null })).toMatchObject({ ok: false, code: "not_approver" });
    expect(await approveRequest({ id: "appr-1", approver: { id: "u-mgr", role: "manager" }, note: null })).toMatchObject({ ok: true, status: "executed" });
  });

  it("the AI's own account cannot approve even if it were listed as an approver", async () => {
    db.setting.findUnique.mockResolvedValue({ value: '{"roles":["sales"],"userIds":["agent-user"]}' });
    // someone mislabelled the AI's user as a salesperson: still refused as its own request
    const out = await approveRequest({ id: "appr-1", approver: { id: "agent-user", role: "sales" }, note: null });
    expect(out).toMatchObject({ ok: false, code: "own_request" });
    expect(state.row!.status).toBe("pending");
  });

  it("refuses an expired request even if the sweep has not marked it yet", async () => {
    const run = vi.fn();
    executors.update_lead_phone = run;
    state.row = makeRow({ expiresAt: new Date(Date.now() - 1000) });
    expect(await approveRequest({ id: "appr-1", approver: admin, note: null })).toMatchObject({ ok: false, code: "expired" });
    expect(run).not.toHaveBeenCalled();
    expect(state.row!.status).toBe("pending");

    state.row = makeRow({ status: "expired" });
    expect(await approveRequest({ id: "appr-1", approver: admin, note: null })).toMatchObject({ ok: false, code: "expired" });
  });

  it("an unknown id is not found", async () => {
    expect(await approveRequest({ id: "nope", approver: admin, note: null })).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("rejecting", () => {
  it("records the decision and note, runs nothing, and cannot be repeated", async () => {
    const run = vi.fn();
    executors.update_lead_phone = run;

    expect(await rejectRequest({ id: "appr-1", approver: admin, note: "Wrong number" })).toEqual({ ok: true });
    expect(state.row).toMatchObject({ status: "rejected", decidedByUserId: "u-admin", decisionNote: "Wrong number" });
    expect(run).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ action: "approval_rejected", approvalId: "appr-1" });

    expect(await rejectRequest({ id: "appr-1", approver: admin, note: "again" })).toMatchObject({ ok: false, code: "not_pending" });
    expect(await approveRequest({ id: "appr-1", approver: admin, note: null })).toMatchObject({ ok: false, code: "not_pending" });
    expect(run).not.toHaveBeenCalled();
  });
});
