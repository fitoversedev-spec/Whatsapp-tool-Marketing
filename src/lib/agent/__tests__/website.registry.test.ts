import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { AGENT_ROUTES, buildOpenApi } from "../openapi";
import { effectiveVerdict, TOOL_REGISTRY } from "../permissions";
import { AREA_EXECUTORS } from "../registry";
import { ROUTES as LEAD_ROUTES, TOOLS as LEAD_TOOLS } from "../registry/leads";
import { ROUTES as READ_ROUTES, TOOLS as READ_TOOLS } from "../registry/read";
import { ROUTES, TOOLS } from "../registry/website";

const ROOT = path.resolve(__dirname, "../../../..");
const routeFile = (apiPath: string) => path.join(ROOT, "src/app/api/agent/v1", apiPath.replace(/\{(\w+)\}/g, "[$1]"), "route.ts");

type Param = { name: string; in: string; required: boolean; schema?: Record<string, unknown> };
type Op = { parameters: Param[]; requestBody?: unknown; "x-tool"?: string; "x-default-verdict"?: string };
const doc = buildOpenApi() as unknown as { paths: Record<string, Record<string, Op>> };

describe("website-lead tools", () => {
  it("registers six tools with the same verdicts and actions as their ad-lead twins", () => {
    expect(Object.keys(TOOLS).sort()).toEqual(
      [
        "add_website_lead_note",
        "assign_website_lead",
        "get_website_lead",
        "list_website_leads",
        "move_website_lead_to_crm",
        "set_website_lead_stage",
      ].sort(),
    );
    expect(TOOLS.list_website_leads).toEqual(READ_TOOLS.list_ad_leads);
    expect(TOOLS.get_website_lead).toEqual(READ_TOOLS.get_ad_lead);
    expect(TOOLS.set_website_lead_stage).toEqual(LEAD_TOOLS.set_ad_lead_stage);
    expect(TOOLS.add_website_lead_note).toEqual(LEAD_TOOLS.add_ad_lead_note);
    expect(TOOLS.move_website_lead_to_crm).toEqual(LEAD_TOOLS.move_ad_lead_to_crm);
    expect(TOOLS).toMatchObject({
      list_website_leads: { default: "ALLOWED", action: "read" },
      get_website_lead: { default: "ALLOWED", action: "read" },
      set_website_lead_stage: { default: "ALLOWED", action: "update" },
      add_website_lead_note: { default: "ALLOWED", action: "create" },
      move_website_lead_to_crm: { default: "ALLOWED", action: "create" },
    });
  });

  it("is part of the global tool registry, and no name is defined twice", () => {
    for (const name of Object.keys(TOOLS)) {
      expect(TOOL_REGISTRY[name], name).toEqual(TOOLS[name]);
      expect(effectiveVerdict(name), name).toBe(TOOLS[name].default);
      expect(Object.keys(READ_TOOLS).concat(Object.keys(LEAD_TOOLS))).not.toContain(name);
    }
  });

  it("assign_website_lead is NEVER, cannot be loosened and has no route", () => {
    expect(TOOLS.assign_website_lead).toEqual({ default: "NEVER", action: "update", neverLoosen: true });
    expect(effectiveVerdict("assign_website_lead", { assign_website_lead: "ALLOWED" })).toBe("NEVER");
    expect(effectiveVerdict("assign_website_lead", { assign_website_lead: "APPROVAL" })).toBe("NEVER");
    expect(AGENT_ROUTES.some((r) => r.tool === "assign_website_lead")).toBe(false);
    expect(existsSync(path.join(ROOT, "src/app/api/agent/v1/website-leads/[id]/assign"))).toBe(false);
    expect(existsSync(path.join(ROOT, "src/app/api/agent/v1/website-leads/assign"))).toBe(false);
  });

  it("no tool here can delete, export, label, group or bulk-edit", () => {
    expect(Object.values(TOOLS).some((t) => t.action === "delete")).toBe(false);
    for (const r of ROUTES) {
      expect(r.method, r.path).not.toBe("delete");
      expect(r.path, r.path).not.toMatch(/export|bulk|labels|marketing|group|incoming/);
    }
  });

  it("an admin can only tighten the allowed tools", () => {
    expect(effectiveVerdict("set_website_lead_stage", { set_website_lead_stage: "APPROVAL" })).toBe("APPROVAL");
    expect(effectiveVerdict("move_website_lead_to_crm", { move_website_lead_to_crm: "NEVER" })).toBe("NEVER");
    expect(effectiveVerdict("list_website_leads", { list_website_leads: "ALLOWED" })).toBe("ALLOWED");
  });

  it("queues nothing for approval, so it adds no approval executor", () => {
    for (const name of Object.keys(TOOLS)) expect(AREA_EXECUTORS[name], name).toBeUndefined();
  });
});

describe("website-lead routes", () => {
  it("has exactly one route per tool except the NEVER one, and no clash with another area", () => {
    expect(ROUTES.map((r) => r.tool).sort()).toEqual(Object.keys(TOOLS).filter((t) => t !== "assign_website_lead").sort());
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    const taken = new Set([...READ_ROUTES, ...LEAD_ROUTES].map((r) => `${r.method} ${r.path}`));
    for (const k of keys) expect(taken.has(k), k).toBe(false);
  });

  it("uses the intended paths and methods", () => {
    const by = Object.fromEntries(ROUTES.map((r) => [r.tool, `${r.method.toUpperCase()} ${r.path}`]));
    expect(by).toEqual({
      list_website_leads: "GET /website-leads",
      get_website_lead: "GET /website-leads/{id}",
      set_website_lead_stage: "POST /website-leads/{id}/stage",
      add_website_lead_note: "POST /website-leads/{id}/notes",
      move_website_lead_to_crm: "POST /website-leads/{id}/move-to-crm",
    });
  });

  it("gives the list a query schema and every POST a request schema, never the reverse", () => {
    for (const r of ROUTES) {
      expect(r.responseSchema, r.path).toBeDefined();
      expect(r.summary.length, r.path).toBeGreaterThan(20);
      if (r.method === "post") {
        expect(r.requestSchema, r.path).toBeDefined();
        expect(r.querySchema, r.path).toBeUndefined();
      } else {
        expect(r.requestSchema, r.path).toBeUndefined();
      }
    }
    expect(ROUTES.find((r) => r.tool === "list_website_leads")!.querySchema).toBeDefined();
    expect(ROUTES.find((r) => r.tool === "get_website_lead")!.querySchema).toBeUndefined();
  });

  for (const r of ROUTES) {
    it(`${r.method.toUpperCase()} ${r.path} has a route file that runs through withAgent`, () => {
      expect(existsSync(routeFile(r.path)), routeFile(r.path)).toBe(true);
      const text = readFileSync(routeFile(r.path), "utf8");
      const mutating = TOOLS[r.tool!].action !== "read";
      expect(text).toMatch(new RegExp(`withAgent\\(\\s*"${r.tool}"`));
      expect(text).toMatch(new RegExp(`export const ${r.method.toUpperCase()} =`));
      expect(text).toMatch(/export const dynamic = "force-dynamic";/);
      expect(text).toMatch(/export const runtime = "nodejs";/);
      expect(text).toMatch(/export const maxDuration = 30;/);
      expect(text).toMatch(new RegExp(`mutating: ${mutating}`));
      expect(text).not.toMatch(/verifyCredential|agent\/keys|getCurrentUser|requireUser/);
      // Writes copy the URL's id into the body first, so the id is always the path's.
      if (mutating) {
        expect(text).toMatch(/withPathIds\(/);
        expect(text).toMatch(/id: "websiteLeadId"/);
      }
    });
  }

  it("is in the OpenAPI document: query parameters on the list, an Idempotency-Key on writes only", () => {
    for (const r of ROUTES) {
      const op = doc.paths[r.path]?.[r.method];
      expect(op, `${r.method} ${r.path}`).toBeDefined();
      expect(op["x-tool"]).toBe(r.tool);
      expect(op["x-default-verdict"]).toBe("ALLOWED");
      const hasKey = op.parameters.some((p) => p.name === "Idempotency-Key" && p.in === "header" && p.required);
      expect(hasKey, r.tool!).toBe(TOOLS[r.tool!].action !== "read");
      expect(!!op.requestBody, r.tool!).toBe(r.method === "post");
    }
    const params = doc.paths["/website-leads"].get.parameters;
    const query = params.filter((p) => p.in === "query").map((p) => p.name);
    expect(query.sort()).toEqual(
      ["areaMax", "areaMin", "assigned", "city", "from", "label", "limit", "page", "q", "sport", "stage", "to"].sort(),
    );
    const limit = params.find((p) => p.name === "limit")!;
    expect(limit.schema).toMatchObject({ type: "integer", minimum: 1, maximum: 100, default: 20 });
    expect(limit.required).toBe(false);
    expect(doc.paths["/website-leads/{id}"].get.parameters.find((p) => p.name === "id")).toMatchObject({ in: "path", required: true });
    expect(JSON.stringify(doc)).not.toMatch(/assign_website_lead/);
  });
});
