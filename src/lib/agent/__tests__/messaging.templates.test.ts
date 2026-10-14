import { describe, expect, it } from "vitest";
import {
  buildTemplateComponents,
  expectedVariableCount,
  extractPlaceholders,
  isApprovedStatus,
  renderTemplateText,
  routeTemplateCategory,
  usableWith,
  validateVariables,
} from "../messaging/templates";

describe("placeholders", () => {
  it("finds distinct numbers in order, tolerating spaces", () => {
    expect(extractPlaceholders("Hi {{1}}, order {{ 2 }} for {{1}}")).toEqual([1, 2]);
    expect(extractPlaceholders("No variables")).toEqual([]);
    expect(extractPlaceholders(null)).toEqual([]);
  });
  it("expected count is the highest placeholder", () => {
    expect(expectedVariableCount("{{1}} {{2}} {{3}}")).toBe(3);
    expect(expectedVariableCount("{{2}}")).toBe(2);
    expect(expectedVariableCount("plain")).toBe(0);
  });
});

describe("validateVariables", () => {
  const body = "Hi {{1}}, your quote {{2}} is ready.";
  it("accepts exactly the right number of clean values", () => {
    expect(validateVariables(body, ["Rahul", "Q-1043"])).toEqual({ ok: true });
    expect(validateVariables("No vars", [])).toEqual({ ok: true });
  });
  it("rejects too few and too many", () => {
    const few = validateVariables(body, ["Rahul"]);
    expect(few.ok).toBe(false);
    expect(few.ok === false && few.message).toMatch(/exactly 2 variables; got 1/);
    expect(validateVariables(body, ["a", "b", "c"]).ok).toBe(false);
    const extra = validateVariables("No vars", ["x"]);
    expect(extra.ok === false && extra.message).toMatch(/exactly 0 variables/);
  });
  it("uses the singular for one variable", () => {
    const r = validateVariables("Hi {{1}}", []);
    expect(r.ok === false && r.message).toMatch(/exactly 1 variable;/);
  });
  it("rejects empty, whitespace-only, over-long, multiline, tabbed and wide-spaced values", () => {
    expect(validateVariables(body, ["Rahul", ""]).ok).toBe(false);
    expect(validateVariables(body, ["Rahul", "   "]).ok).toBe(false);
    expect(validateVariables(body, ["Rahul", "x".repeat(1001)]).ok).toBe(false);
    expect(validateVariables(body, ["Rahul", "a\nb"]).ok).toBe(false);
    expect(validateVariables(body, ["Rahul", "a\tb"]).ok).toBe(false);
    expect(validateVariables(body, ["Rahul", "a     b"]).ok).toBe(false);
    expect(validateVariables(body, ["Rahul", "a    b"]).ok).toBe(true); // 4 spaces is allowed
    expect(validateVariables(body, ["Rahul", "x".repeat(1000)]).ok).toBe(true);
  });
});

describe("renderTemplateText", () => {
  it("fills placeholders in order and repeats", () => {
    expect(renderTemplateText("Hi {{1}}, {{2}} / {{1}}", ["A", "B"])).toBe("Hi A, B / A");
    expect(renderTemplateText("Hi {{ 1 }}", ["A"])).toBe("Hi A");
  });
});

describe("buildTemplateComponents", () => {
  it("adds a body component only when the body has placeholders", () => {
    expect(buildTemplateComponents(null, "No vars", [])).toEqual([]);
    expect(buildTemplateComponents(null, "Hi {{1}} {{2}}", ["A", "B"])).toEqual([
      { type: "body", parameters: [{ type: "text", text: "A" }, { type: "text", text: "B" }] },
    ]);
  });
  it("adds the stored media header first", () => {
    const header = JSON.stringify({ format: "IMAGE", url: "https://files.test/a.jpg" });
    const c = buildTemplateComponents(header, "Hi {{1}}", ["A"]);
    expect(c[0]).toEqual({ type: "header", parameters: [{ type: "image", image: { link: "https://files.test/a.jpg" } }] });
    expect(c[1]).toMatchObject({ type: "body" });
    const doc = buildTemplateComponents(JSON.stringify({ format: "DOCUMENT", url: "https://f.test/x.pdf" }), "x", []);
    expect(doc[0]).toMatchObject({ parameters: [{ type: "document", document: { filename: "document.pdf" } }] });
  });
  it("ignores text headers and unreadable header JSON", () => {
    expect(buildTemplateComponents(JSON.stringify({ format: "TEXT", text: "Hello" }), "x", [])).toEqual([]);
    expect(buildTemplateComponents("{not json", "x", [])).toEqual([]);
  });
});

describe("marketing vs utility routing", () => {
  it("send_template accepts UTILITY only", () => {
    expect(routeTemplateCategory("send_template", "UTILITY")).toEqual({ ok: true });
    expect(routeTemplateCategory("send_template", " utility ")).toEqual({ ok: true });
  });
  it("send_template rejects MARKETING with a pointer to the approval tool", () => {
    const r = routeTemplateCategory("send_template", "MARKETING");
    expect(r).toMatchObject({ ok: false, code: "use_marketing_tool" });
    expect(r.ok === false && r.message).toMatch(/send_marketing_template/);
  });
  it("send_marketing_template accepts MARKETING only", () => {
    expect(routeTemplateCategory("send_marketing_template", "MARKETING")).toEqual({ ok: true });
    expect(routeTemplateCategory("send_marketing_template", "UTILITY")).toMatchObject({
      ok: false,
      code: "use_send_template",
    });
  });
  it("AUTHENTICATION and unknown categories are never sendable by the AI", () => {
    for (const tool of ["send_template", "send_marketing_template"] as const) {
      for (const c of ["AUTHENTICATION", "", null, undefined, "SERVICE"]) {
        expect(routeTemplateCategory(tool, c)).toMatchObject({ ok: false, code: "template_category_not_allowed" });
      }
    }
  });
  it("usableWith mirrors the routing and hides everything else", () => {
    expect(usableWith("UTILITY")).toBe("send_template");
    expect(usableWith("marketing")).toBe("send_marketing_template");
    expect(usableWith("AUTHENTICATION")).toBeNull();
  });
});

describe("approved status", () => {
  it("accepts approved in any case and nothing else", () => {
    expect(isApprovedStatus("approved")).toBe(true);
    expect(isApprovedStatus("APPROVED")).toBe(true);
    for (const s of ["draft", "submitted", "rejected", "paused", "", null, undefined]) {
      expect(isApprovedStatus(s)).toBe(false);
    }
  });
});
