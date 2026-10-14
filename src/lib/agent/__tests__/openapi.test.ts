import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { AGENT_ROUTES, buildOpenApi } from "../openapi";

type Doc = {
  openapi: string;
  servers: { url: string }[];
  paths: Record<string, Record<string, any>>;
  components: { schemas: Record<string, any>; securitySchemes: Record<string, any> };
};

describe("buildOpenApi", () => {
  const doc = buildOpenApi() as unknown as Doc;

  it("is an OpenAPI 3.1 document for /api/agent/v1", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "/api/agent/v1" }]);
    // One path can carry several methods (GET /leads and POST /leads), so compare distinct paths
    // and make sure every registered method is present on its path.
    expect(Object.keys(doc.paths).sort()).toEqual(Array.from(new Set(AGENT_ROUTES.map((r) => r.path))).sort());
    for (const r of AGENT_ROUTES) expect(doc.paths[r.path][r.method], `${r.method} ${r.path}`).toBeDefined();
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/health", "/whoami", "/openapi.json"]));
  });

  it("whoami needs the bearer key; health and the spec do not", () => {
    expect(doc.paths["/whoami"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths["/health"].get.security).toEqual([]);
    expect(doc.paths["/openapi.json"].get.security).toEqual([]);
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("derives schemas from the zod objects", () => {
    const whoami = doc.paths["/whoami"].get.responses["200"].content["application/json"].schema;
    expect(whoami.type).toBe("object");
    expect(Object.keys(whoami.properties)).toEqual(
      expect.arrayContaining(["identity", "environment", "credential", "permissions", "rateLimits"]),
    );
    expect(doc.components.schemas.Error.properties.error.properties.code.enum).toContain("never_allowed");
    expect(doc.paths["/whoami"].get["x-tool"]).toBe("whoami");
  });

  it("documents the standard error responses on authenticated routes", () => {
    const responses = doc.paths["/whoami"].get.responses;
    for (const status of ["401", "403", "429", "500"]) expect(responses[status]).toBeDefined();
    expect(responses["429"].headers["Retry-After"]).toBeDefined();
  });

  it("serialises to plain JSON with no $schema noise or leaked internals", () => {
    const json = JSON.stringify(doc);
    expect(JSON.parse(json)).toEqual(doc);
    expect(json).not.toContain('"$schema"');
    expect(json.toLowerCase()).not.toContain("database");
    expect(json).not.toMatch(/fvai_(dev|stg|prd)_[a-f0-9]{16}_/);
  });
});
