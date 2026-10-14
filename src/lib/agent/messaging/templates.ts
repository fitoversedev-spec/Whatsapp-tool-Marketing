import type { TemplateComponent } from "@/lib/whatsapp";

/** Pure template rules for send_template / send_marketing_template. */
export type TemplateTool = "send_template" | "send_marketing_template";

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;
export const MAX_VARIABLE_LENGTH = 1000;

export function isApprovedStatus(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "approved";
}

/** {{1}} {{2}} ... in the body, distinct and ascending. */
export function extractPlaceholders(body: string | null | undefined): number[] {
  const seen = new Set<number>();
  for (const m of (body ?? "").matchAll(PLACEHOLDER)) seen.add(Number(m[1]));
  return [...seen].sort((a, b) => a - b);
}

/** How many variables the caller must supply (the highest placeholder number). */
export function expectedVariableCount(body: string | null | undefined): number {
  const p = extractPlaceholders(body);
  return p.length ? p[p.length - 1] : 0;
}

export type VariableCheck = { ok: true } | { ok: false; message: string };

/**
 * Exactly as many values as the body has placeholders (Meta rejects both missing
 * and extra parameters), each non-empty, with no newline/tab or 5+ spaces in a
 * row (Meta rejects those too) and not absurdly long.
 */
export function validateVariables(body: string | null | undefined, variables: readonly string[]): VariableCheck {
  const expected = expectedVariableCount(body);
  if (variables.length !== expected) {
    return {
      ok: false,
      message: `This template needs exactly ${expected} variable${expected === 1 ? "" : "s"}; got ${variables.length}.`,
    };
  }
  for (let i = 0; i < variables.length; i++) {
    const v = variables[i];
    if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, message: `Variable ${i + 1} is empty.` };
    }
    if (v.length > MAX_VARIABLE_LENGTH) {
      return { ok: false, message: `Variable ${i + 1} is longer than ${MAX_VARIABLE_LENGTH} characters.` };
    }
    if (/[\n\r\t]| {5,}/.test(v)) {
      return { ok: false, message: `Variable ${i + 1} must not contain line breaks, tabs or 5+ spaces in a row.` };
    }
  }
  return { ok: true };
}

/** The text the customer sees; stored in Message.body so the inbox reads like a chat. */
export function renderTemplateText(body: string | null | undefined, variables: readonly string[]): string {
  return (body ?? "").replace(PLACEHOLDER, (_, n) => variables[Number(n) - 1] ?? "");
}

/**
 * Meta "components" for a template send. Mirrors the broadcast sender: a media
 * header (the stored URL) when the template has one, and a body component only
 * when the body has placeholders (parameters on a no-variable template are
 * rejected with #132000).
 */
export function buildTemplateComponents(
  headerJson: string | null | undefined,
  body: string | null | undefined,
  variables: readonly string[],
): TemplateComponent[] {
  const components: TemplateComponent[] = [];
  if (headerJson) {
    try {
      const h = JSON.parse(headerJson) as { format?: string; url?: string; filename?: string };
      if (h.url && h.format === "IMAGE") {
        components.push({ type: "header", parameters: [{ type: "image", image: { link: h.url } }] });
      } else if (h.url && h.format === "VIDEO") {
        components.push({ type: "header", parameters: [{ type: "video", video: { link: h.url } } as never] });
      } else if (h.url && h.format === "DOCUMENT") {
        components.push({
          type: "header",
          parameters: [{ type: "document", document: { link: h.url, filename: h.filename ?? "document.pdf" } }],
        });
      }
    } catch {
      /* text/unreadable header: nothing to add */
    }
  }
  if (expectedVariableCount(body) > 0) {
    components.push({ type: "body", parameters: variables.map((text) => ({ type: "text" as const, text })) });
  }
  return components;
}

export type TemplateRoute =
  | { ok: true }
  | { ok: false; code: "use_marketing_tool" | "use_send_template" | "template_category_not_allowed"; message: string };

/**
 * UTILITY goes through send_template (allowed), MARKETING only through
 * send_marketing_template (human approval), and nothing else (AUTHENTICATION,
 * unknown) is ever sent by the AI.
 */
export function routeTemplateCategory(tool: TemplateTool, category: string | null | undefined): TemplateRoute {
  const c = (category ?? "").trim().toUpperCase();
  if (tool === "send_template") {
    if (c === "UTILITY") return { ok: true };
    if (c === "MARKETING") {
      return {
        ok: false,
        code: "use_marketing_tool",
        message: "MARKETING templates need human approval: use send_marketing_template.",
      };
    }
  } else {
    if (c === "MARKETING") return { ok: true };
    if (c === "UTILITY") {
      return { ok: false, code: "use_send_template", message: "UTILITY templates are sent with send_template." };
    }
  }
  return {
    ok: false,
    code: "template_category_not_allowed",
    message: "The AI agent may not send templates of this category.",
  };
}

export function usableWith(category: string | null | undefined): TemplateTool | null {
  const c = (category ?? "").trim().toUpperCase();
  return c === "UTILITY" ? "send_template" : c === "MARKETING" ? "send_marketing_template" : null;
}
