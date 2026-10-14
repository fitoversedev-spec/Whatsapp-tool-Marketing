import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  deal: { findUnique: vi.fn(), update: vi.fn() },
  setting: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));

import { effectiveTable, effectiveVerdict, TOOL_REGISTRY } from "../permissions";
import { EXECUTORS, ROUTES, TOOLS } from "../registry/deals";
import { AREA_EXECUTORS } from "../registry";
import { setDealExecutionStatus, updateDealWonValue } from "../deals/dealEdits";
import { setDealExecutionStatusExecutor, updateDealWonValueExecutor } from "../deals/executors";
import {
  setDealExecutionStatusBodySchema,
  setDealExecutionStatusInputSchema,
  updateDealWonValueBodySchema,
  updateDealWonValueInputSchema,
} from "../schemas/deals";
import { executionStatusPatch, wonDetailsPatch } from "@/lib/crm/dealEdits";
import type { AgentHandlerResult } from "../withAgent";

const ROOT = path.resolve(__dirname, "../../../..");
const DEAL = "22222222-2222-4222-8222-222222222222";
const CTX = {
  identityId: "idn-1",
  userId: "agent-user",
  credentialId: "cred-1",
  environment: "staging" as const,
  correlationId: "corr-12345678",
  ip: null,
};
const code = (r: { body: unknown }) => (r.body as { error: { code: string } }).error.code;

const dealRow = (over: Record<string, unknown> = {}) => ({
  id: DEAL,
  code: "FIT-D-1",
  outcome: "WON",
  deletedAt: null,
  executionStatus: null,
  executionStartedAt: null,
  wonValue: 250000,
  expectedStartAt: null,
  wonNote: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.deal.findUnique.mockResolvedValue(dealRow());
  db.deal.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => dealRow(data));
});

describe("deal registry", () => {
  it("registers the agreed verdicts", () => {
    const want: Record<string, string> = {
      set_deal_execution_status: "APPROVAL",
      update_deal_won_value: "APPROVAL",
      delete_deal: "NEVER",
      change_deal_owner: "NEVER",
    };
    const table = effectiveTable({});
    for (const [tool, verdict] of Object.entries(want)) expect(table[tool], tool).toBe(verdict);
  });

  it("delete_deal and change_deal_owner are NEVER, cannot be loosened and have no route", () => {
    for (const t of ["delete_deal", "change_deal_owner"]) {
      expect(TOOLS[t]).toMatchObject({ default: "NEVER", neverLoosen: true });
      expect(effectiveVerdict(t, { [t]: "ALLOWED" })).toBe("NEVER");
      expect(effectiveVerdict(t, { [t]: "APPROVAL" })).toBe("NEVER");
      expect(ROUTES.some((r) => r.tool === t)).toBe(false);
      expect(TOOL_REGISTRY[t]).toBeDefined();
    }
  });

  it("the two deal edits wait for a human and can only get stricter", () => {
    for (const t of ["set_deal_execution_status", "update_deal_won_value"]) {
      expect(TOOLS[t]).toMatchObject({ default: "APPROVAL", neverLoosen: true, action: "update" });
      expect(effectiveVerdict(t, { [t]: "ALLOWED" })).toBe("APPROVAL");
      expect(effectiveVerdict(t, { [t]: "NEVER" })).toBe("NEVER");
    }
  });

  it("has an executor for every APPROVAL tool in the area, and only for those", () => {
    const approval = Object.keys(TOOLS).filter((t) => TOOLS[t].default === "APPROVAL").sort();
    expect(Object.keys(EXECUTORS).sort()).toEqual(approval);
    for (const t of approval) expect(AREA_EXECUTORS[t], t).toBeDefined();
  });

  it("has a route.ts wrapping each registered deal route in withAgent", () => {
    for (const r of ROUTES.filter((x) => x.path.startsWith("/deals/"))) {
      const file = path.join(ROOT, "src/app/api/agent/v1", r.path.replace(/\{id\}/g, "[id]"), "route.ts");
      expect(existsSync(file), file).toBe(true);
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain(`withAgent("${r.tool}"`);
      // the id from the URL must travel with the approval request
      expect(text, file).toContain("withPathIds");
      expect(text, file).toContain('id: "dealId"');
    }
  });
});

describe("request schemas", () => {
  it("execution status accepts only IN_EXECUTION or COMPLETED", () => {
    expect(setDealExecutionStatusBodySchema.safeParse({ status: "IN_EXECUTION" }).success).toBe(true);
    expect(setDealExecutionStatusBodySchema.safeParse({ status: "COMPLETED", reason: "Handed over" }).success).toBe(true);
    for (const bad of [{ status: "WON" }, { status: "in_execution" }, {}, { status: "COMPLETED", ownerUserId: "x" }]) {
      expect(setDealExecutionStatusBodySchema.safeParse(bad).success).toBe(false);
    }
    expect(setDealExecutionStatusInputSchema.safeParse({ dealId: DEAL, status: "COMPLETED" }).success).toBe(true);
    expect(setDealExecutionStatusInputSchema.safeParse({ dealId: "nope", status: "COMPLETED" }).success).toBe(false);
  });

  it("won value validates value, start date and note, and needs at least one", () => {
    const ok = updateDealWonValueBodySchema.safeParse({ wonValue: 1250000.5, expectedStartAt: "2026-11-01T00:00:00+05:30", wonNote: "Site ready" });
    expect(ok.success).toBe(true);
    expect(updateDealWonValueBodySchema.safeParse({ expectedStartAt: null, wonNote: null }).success).toBe(true);
    const bad: unknown[] = [
      {},
      { reason: "only a reason" },
      { wonValue: 0 },
      { wonValue: -5 },
      { wonValue: 1_000_000_000 },
      { wonValue: "100" },
      { expectedStartAt: "next week" },
      { wonNote: "" },
      { wonNote: "x".repeat(1001) },
      { wonValue: 100, ownerUserId: DEAL },
      { wonValue: 100, deleted: true },
    ];
    for (const b of bad) expect(updateDealWonValueBodySchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
    expect(updateDealWonValueInputSchema.safeParse({ dealId: DEAL, wonValue: 10 }).success).toBe(true);
    expect(updateDealWonValueInputSchema.safeParse({ dealId: DEAL }).success).toBe(false);
  });
});

describe("set_deal_execution_status", () => {
  const run = (status: "IN_EXECUTION" | "COMPLETED") =>
    setDealExecutionStatus({ ctx: CTX, input: { dealId: DEAL, status } });

  it("starts execution and stamps the start time on the server", async () => {
    const r = await run("IN_EXECUTION");
    const data = db.deal.update.mock.calls[0][0].data;
    expect(data.executionStatus).toBe("IN_EXECUTION");
    expect(data.executionStartedAt).toBeInstanceOf(Date);
    expect(data.deliveryCompletedAt).toBeUndefined();
    expect(r.body).toMatchObject({ changed: true, deal: { id: DEAL, executionStatus: "IN_EXECUTION" } });
    expect(r.fieldsChanged).toEqual(["executionStatus", "executionStartedAt"]);
  });

  it("completing stamps the delivery date and fills a missing start, never moving an existing start", async () => {
    await run("COMPLETED");
    const first = db.deal.update.mock.calls[0][0].data;
    expect(first.deliveryCompletedAt).toBeInstanceOf(Date);
    expect(first.executionStartedAt).toBeInstanceOf(Date);

    const started = new Date("2026-09-01T00:00:00Z");
    db.deal.findUnique.mockResolvedValue(dealRow({ executionStatus: "IN_EXECUTION", executionStartedAt: started }));
    await run("COMPLETED");
    const second = db.deal.update.mock.calls[1][0].data;
    expect(second.deliveryCompletedAt).toBeInstanceOf(Date);
    expect("executionStartedAt" in second).toBe(false);
  });

  it("repeating the same status changes nothing", async () => {
    db.deal.findUnique.mockResolvedValue(dealRow({ executionStatus: "COMPLETED" }));
    const r = await run("COMPLETED");
    expect(db.deal.update).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ changed: false });
  });

  it("refuses a deal that is not Won", async () => {
    db.deal.findUnique.mockResolvedValue(dealRow({ outcome: null }));
    const r = await run("IN_EXECUTION");
    expect(r.status).toBe(422);
    expect(code(r)).toBe("deal_not_won");
    expect(db.deal.update).not.toHaveBeenCalled();
  });

  it("404s on a missing or deleted deal", async () => {
    db.deal.findUnique.mockResolvedValue(null);
    await expect(run("IN_EXECUTION")).rejects.toMatchObject({ code: "not_found" });
    db.deal.findUnique.mockResolvedValue(dealRow({ deletedAt: new Date() }));
    await expect(run("IN_EXECUTION")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("update_deal_won_value", () => {
  const run = (input: Record<string, unknown>) =>
    updateDealWonValue({ ctx: CTX, input: { dealId: DEAL, ...input } as never });

  it("writes only the fields sent", async () => {
    const r = await run({ wonValue: 300000 });
    expect(db.deal.update.mock.calls[0][0].data).toEqual({ wonValue: 300000 });
    expect(r.fieldsChanged).toEqual(["wonValue"]);
  });

  it("turns the date into a Date, and clears the date and note with null", async () => {
    await run({ expectedStartAt: "2026-11-01T00:00:00+05:30", wonNote: null });
    const data = db.deal.update.mock.calls[0][0].data;
    expect(data.expectedStartAt).toEqual(new Date("2026-11-01T00:00:00+05:30"));
    expect(data.wonNote).toBeNull();
    db.deal.findUnique.mockResolvedValue(dealRow({ expectedStartAt: new Date("2026-11-01T00:00:00+05:30") }));
    await run({ expectedStartAt: null });
    expect(db.deal.update.mock.calls[1][0].data).toEqual({ expectedStartAt: null });
  });

  it("does nothing when the values are already those", async () => {
    db.deal.findUnique.mockResolvedValue(dealRow({ wonValue: 250000, wonNote: "ok" }));
    const r = await run({ wonValue: 250000, wonNote: "ok" });
    expect(db.deal.update).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ changed: false });
  });

  it("refuses a deal that is not Won and never touches an owner or deletion", async () => {
    db.deal.findUnique.mockResolvedValue(dealRow({ outcome: "LOST" }));
    const r = await run({ wonValue: 1 });
    expect(code(r)).toBe("deal_not_won");
    expect(db.deal.update).not.toHaveBeenCalled();
    // whatever the handler writes, it is limited to these three columns
    db.deal.findUnique.mockResolvedValue(dealRow());
    await run({ wonValue: 5, expectedStartAt: null, wonNote: "n" });
    expect(Object.keys(db.deal.update.mock.calls[0][0].data).sort()).toEqual(["expectedStartAt", "wonNote", "wonValue"]);
  });
});

describe("shared patch builders keep the human PATCH behaviour", () => {
  it("execution status", () => {
    expect(executionStatusPatch({ executionStartedAt: null }, "IN_EXECUTION")).toMatchObject({ executionStatus: "IN_EXECUTION" });
    const started = new Date(0);
    expect(executionStatusPatch({ executionStartedAt: started }, "IN_EXECUTION")).toEqual({ executionStatus: "IN_EXECUTION" });
    const done = executionStatusPatch({ executionStartedAt: started }, "COMPLETED");
    expect(Object.keys(done).sort()).toEqual(["deliveryCompletedAt", "executionStatus"]);
  });
  it("won details", () => {
    expect(wonDetailsPatch({})).toEqual({});
    expect(wonDetailsPatch({ wonNote: "" })).toEqual({ wonNote: null });
    expect(wonDetailsPatch({ expectedStartAt: null })).toEqual({ expectedStartAt: null });
  });
});

describe("approval executors", () => {
  const exec = (fn: typeof setDealExecutionStatusExecutor, input: unknown) =>
    fn({ ctx: CTX, input, approvalId: "appr-1", approvedByUserId: "human-1" });

  it("run the stored request through the same handler", async () => {
    const r = await exec(setDealExecutionStatusExecutor, { dealId: DEAL, status: "IN_EXECUTION" });
    expect(r.status).toBe(200);
    expect(db.deal.update).toHaveBeenCalledTimes(1);
    expect(r.recordIds).toEqual({ dealId: DEAL });
    const w = await exec(updateDealWonValueExecutor, { dealId: DEAL, wonValue: 99 });
    expect(w.status).toBe(200);
    expect(db.deal.update.mock.calls[1][0].data).toEqual({ wonValue: 99 });
  });

  it("refuse a stored request that no longer validates, without touching the deal", async () => {
    for (const input of [{ dealId: DEAL, status: "WON" }, { status: "COMPLETED" }, null, { dealId: DEAL, status: "COMPLETED", ownerUserId: "x" }]) {
      const r = await exec(setDealExecutionStatusExecutor, input);
      expect(r.status).toBe(400);
    }
    expect((await exec(updateDealWonValueExecutor, { dealId: DEAL })).status).toBe(400);
    expect(db.deal.findUnique).not.toHaveBeenCalled();
    expect(db.deal.update).not.toHaveBeenCalled();
  });

  it("turn a controlled error into an answer (a deal deleted since the request)", async () => {
    db.deal.findUnique.mockResolvedValue(null);
    const r = await exec(setDealExecutionStatusExecutor, { dealId: DEAL, status: "COMPLETED" });
    expect(r.status).toBe(404);
    expect((r.body as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("the registry executors load lazily and behave the same", async () => {
    const r = await EXECUTORS.update_deal_won_value({ ctx: CTX, input: { dealId: DEAL, wonValue: 7 }, approvalId: "a", approvedByUserId: "h" });
    expect(r.status).toBe(200);
    const bad: AgentHandlerResult | { status: number } = await EXECUTORS.set_deal_execution_status({
      ctx: CTX,
      input: { dealId: DEAL, status: "nope" },
      approvalId: "a",
      approvedByUserId: "h",
    });
    expect(bad.status).toBe(400);
  });
});
