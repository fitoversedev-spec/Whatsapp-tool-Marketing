import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const links = vi.hoisted(() => ({ contactsMatchingPhone: vi.fn() }));
vi.mock("@/lib/crm/contactLinks", () => links);

import { BADGE_LABELS, getBadgesForLead, getBadgesForLeads, lastTenDigits } from "../badges";

const lead = { id: "L1", phone: "+91 98765 43210", normalizedPhone: "919876543210" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lastTenDigits", () => {
  it("takes the last 10 digits however the number is typed", () => {
    expect(lastTenDigits("+91 98765-43210")).toBe("9876543210");
    expect(lastTenDigits("098765 43210")).toBe("9876543210");
    expect(lastTenDigits("9876543210")).toBe("9876543210");
  });
  it("is null for too-short or empty numbers", () => {
    expect(lastTenDigits("12345")).toBeNull();
    expect(lastTenDigits("")).toBeNull();
    expect(lastTenDigits(null)).toBeNull();
  });
});

describe("getBadgesForLeads", () => {
  it("matches CRM contacts, ad leads and WhatsApp contacts by last 10 digits, each with its id", async () => {
    // query order: CRM contacts, ad leads, WhatsApp contacts
    db.$queryRaw
      .mockResolvedValueOnce([{ id: "AC1", phone: "98765 43210" }])
      .mockResolvedValueOnce([{ id: "M1", phone: "919876543210" }])
      .mockResolvedValueOnce([{ id: "W1", phone: "919876543210" }]);
    const map = await getBadgesForLeads([lead]);
    expect(map.get("L1")).toEqual([
      { kind: "crm", label: "Already in CRM", id: "AC1" },
      { kind: "ad_lead", label: "Also an ad lead", id: "M1" },
      { kind: "whatsapp", label: "WhatsApp contact", id: "W1" },
    ]);
    expect(BADGE_LABELS).toEqual({ crm: "Already in CRM", ad_lead: "Also an ad lead", whatsapp: "WhatsApp contact" });
  });

  it("asks the database for the last 10 digits of every lead in one go", async () => {
    db.$queryRaw.mockResolvedValue([]);
    await getBadgesForLeads([lead, { id: "L2", phone: "08015910405", normalizedPhone: null }, { id: "L3", phone: "123", normalizedPhone: null }]);
    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
    for (const call of db.$queryRaw.mock.calls) expect(call[1]).toEqual(["9876543210", "8015910405"]);
  });

  it("same last 10 digits but a different country code is not a match", async () => {
    db.$queryRaw
      .mockResolvedValueOnce([{ id: "AC9", phone: "+44 9876543210" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const map = await getBadgesForLeads([lead]);
    expect(map.has("L1")).toBe(false);
  });

  it("only the badges that apply are shown; leads with none are absent", async () => {
    db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "M1", phone: "919876543210" }])
      .mockResolvedValueOnce([]);
    const map = await getBadgesForLeads([lead, { id: "L2", phone: "919811122233", normalizedPhone: "919811122233" }]);
    expect(map.get("L1")).toEqual([{ kind: "ad_lead", label: "Also an ad lead", id: "M1" }]);
    expect(map.has("L2")).toBe(false);
  });

  it("two leads with the same number both get the badge", async () => {
    db.$queryRaw
      .mockResolvedValueOnce([{ id: "AC1", phone: "919876543210" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const map = await getBadgesForLeads([lead, { id: "L9", phone: "9876543210", normalizedPhone: null }]);
    expect(map.get("L1")?.[0].id).toBe("AC1");
    expect(map.get("L9")?.[0].id).toBe("AC1");
  });

  it("makes no queries when no lead has a usable number", async () => {
    const map = await getBadgesForLeads([{ id: "L3", phone: "123", normalizedPhone: null }]);
    expect(map.size).toBe(0);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("getBadgesForLead (detail page)", () => {
  it("uses contactsMatchingPhone for the CRM badge", async () => {
    links.contactsMatchingPhone.mockResolvedValue([{ id: "AC7", phone: "919876543210" }]);
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "W2", phone: "919876543210" }]);
    const badges = await getBadgesForLead(lead);
    expect(links.contactsMatchingPhone).toHaveBeenCalledWith("919876543210");
    expect(badges).toEqual([
      { kind: "crm", label: "Already in CRM", id: "AC7" },
      { kind: "whatsapp", label: "WhatsApp contact", id: "W2" },
    ]);
  });

  it("no usable number, no badges", async () => {
    expect(await getBadgesForLead({ id: "L3", phone: "12", normalizedPhone: null })).toEqual([]);
    expect(links.contactsMatchingPhone).not.toHaveBeenCalled();
  });
});
