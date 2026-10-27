import { describe, expect, it } from "vitest";
import * as S from "../schemas/website";

const UUID = "00000000-0000-4000-8000-000000000001";
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe("websiteLeadsQuerySchema", () => {
  it("defaults to 20 rows on page 1 and treats blank values as absent", () => {
    const r = S.websiteLeadsQuerySchema.parse({ city: "", sport: " ", areaMin: "", limit: "", page: "" });
    expect(r).toMatchObject({ limit: 20, page: 1 });
    expect(r.city).toBeUndefined();
    expect(r.sport).toBeUndefined();
    expect(r.areaMin).toBeUndefined();
  });

  it("caps limit at 100 and rejects 0 and non-numbers", () => {
    expect(S.websiteLeadsQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(ok(S.websiteLeadsQuerySchema, { limit: "101" })).toBe(false);
    expect(ok(S.websiteLeadsQuerySchema, { limit: "0" })).toBe(false);
    expect(ok(S.websiteLeadsQuerySchema, { limit: "many" })).toBe(false);
    expect(ok(S.websiteLeadsQuerySchema, { page: "0" })).toBe(false);
  });

  it("accepts every filter, with the court size as whole numbers", () => {
    const r = S.websiteLeadsQuerySchema.parse({
      from: "2026-10-01",
      to: "2026-10-31",
      city: " Goa ",
      sport: "football",
      areaMin: "1000",
      areaMax: "6000",
      stage: "NEW",
      assigned: "unassigned",
      label: "Hot",
      q: "98765",
      limit: "50",
      page: "2",
    });
    expect(r).toMatchObject({ city: "Goa", areaMin: 1000, areaMax: 6000, limit: 50, page: 2, assigned: "unassigned" });
  });

  it("rejects a bad date, a reversed range, a negative or fractional size and a reversed size range", () => {
    expect(ok(S.websiteLeadsQuerySchema, { from: "01-10-2026" })).toBe(false);
    expect(ok(S.websiteLeadsQuerySchema, { from: "2026-10-31", to: "2026-10-01" })).toBe(false);
    expect(ok(S.websiteLeadsQuerySchema, { areaMin: "-1" })).toBe(false);
    expect(ok(S.websiteLeadsQuerySchema, { areaMin: "10.5" })).toBe(false);
    expect(ok(S.websiteLeadsQuerySchema, { areaMin: "5000", areaMax: "1000" })).toBe(false);
    expect(ok(S.websiteLeadsQuerySchema, { areaMin: "1000", areaMax: "1000" })).toBe(true);
  });

  it("bounds free text", () => {
    expect(ok(S.websiteLeadsQuerySchema, { q: "x".repeat(100) })).toBe(true);
    expect(ok(S.websiteLeadsQuerySchema, { q: "x".repeat(101) })).toBe(false);
  });
});

describe("set_website_lead_stage", () => {
  it("takes a stage slug and nothing else", () => {
    expect(ok(S.setWebsiteLeadStageBodySchema, { stage: "CONTACTED" })).toBe(true);
    expect(S.setWebsiteLeadStageBodySchema.parse({ stage: "  QUALIFIED " }).stage).toBe("QUALIFIED");
    expect(ok(S.setWebsiteLeadStageBodySchema, {})).toBe(false);
    expect(ok(S.setWebsiteLeadStageBodySchema, { stage: "" })).toBe(false);
    expect(ok(S.setWebsiteLeadStageBodySchema, { stage: "x".repeat(101) })).toBe(false);
    expect(ok(S.setWebsiteLeadStageBodySchema, { stage: "NEW", assignedToUserId: UUID })).toBe(false);
  });

  it("the input also needs the lead id from the URL, as a uuid", () => {
    expect(ok(S.setWebsiteLeadStageInputSchema, { websiteLeadId: UUID, stage: "NEW" })).toBe(true);
    expect(ok(S.setWebsiteLeadStageInputSchema, { stage: "NEW" })).toBe(false);
    expect(ok(S.setWebsiteLeadStageInputSchema, { websiteLeadId: "nope", stage: "NEW" })).toBe(false);
  });
});

describe("add_website_lead_note", () => {
  it("allows up to 5000 characters and trims", () => {
    expect(S.WEBSITE_LEAD_NOTE_MAX).toBe(5000);
    expect(ok(S.addWebsiteLeadNoteBodySchema, { body: "x".repeat(5000) })).toBe(true);
    expect(ok(S.addWebsiteLeadNoteBodySchema, { body: "x".repeat(5001) })).toBe(false);
    expect(S.addWebsiteLeadNoteBodySchema.parse({ body: "  hello  " }).body).toBe("hello");
  });

  it("rejects an empty note, a missing body and an author the caller made up", () => {
    expect(ok(S.addWebsiteLeadNoteBodySchema, { body: "   " })).toBe(false);
    expect(ok(S.addWebsiteLeadNoteBodySchema, {})).toBe(false);
    expect(ok(S.addWebsiteLeadNoteBodySchema, { body: "hi", authorUserId: UUID })).toBe(false);
    expect(ok(S.addWebsiteLeadNoteInputSchema, { websiteLeadId: UUID, body: "hi" })).toBe(true);
    expect(ok(S.addWebsiteLeadNoteInputSchema, { body: "hi" })).toBe(false);
  });
});

describe("move_website_lead_to_crm", () => {
  it("takes no body fields, in particular no owner", () => {
    expect(ok(S.moveWebsiteLeadBodySchema, {})).toBe(true);
    expect(ok(S.moveWebsiteLeadBodySchema, { ownerUserId: UUID })).toBe(false);
    expect(ok(S.moveWebsiteLeadBodySchema, { owner: UUID })).toBe(false);
    expect(ok(S.moveWebsiteLeadInputSchema, { websiteLeadId: UUID })).toBe(true);
    expect(ok(S.moveWebsiteLeadInputSchema, { websiteLeadId: UUID, ownerUserId: UUID })).toBe(false);
  });
});

describe("response schemas", () => {
  it("expose no internal field", () => {
    const keys = (o: { shape: Record<string, unknown> }) => Object.keys(o.shape);
    const all = [...keys(S.websiteLeadRowSchema), ...keys(S.websiteLeadDetailSchema)];
    for (const internal of [
      "normalizedPhone",
      "assignedToUserId",
      "accountContactId",
      "contactId",
      "userAgent",
      "websiteLeadId",
      "source",
      "deletedAt",
      "authorUserId",
    ]) {
      expect(all, internal).not.toContain(internal);
    }
    expect(keys(S.websiteLeadRowSchema)).toEqual(
      expect.arrayContaining(["name", "phone", "city", "sport", "size", "startTime", "stage", "assignedTo", "receivedAt", "badges"]),
    );
  });
});
