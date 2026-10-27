import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  websiteLead: { create: vi.fn() },
  metaLeadStage: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  setting: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const push = vi.hoisted(() => ({ sendPushToUser: vi.fn() }));
vi.mock("@/lib/push", () => push);

// Run the deferred work right away and let the tests wait for it.
const pending = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("@/lib/scout/after", () => ({
  after: (work: (() => unknown) | Promise<unknown>) => {
    pending.push(Promise.resolve(typeof work === "function" ? work() : work));
  },
}));

import {
  attributionColumns,
  ingestWebsiteLead,
  isLiveWebsiteLead,
  isValidIncomingKey,
  parseWebsiteLeadPayload,
  sanitizeAttribution,
  websiteLeadPushBody,
} from "../ingest";
import { WEBSITE_LEAD_KEY_SETTING, generateWebsiteLeadKey, hashWebsiteLeadKey, keyMatchesHash } from "../key";

const payload = (over: Record<string, unknown> = {}) => ({
  id: "6f1f3a52-0e0b-4c8e-9b57-1f2a3b4c5d6e",
  receivedAt: new Date().toISOString(),
  name: "Asha Rao",
  phone: "+919876543210",
  email: "asha@example.com",
  city: "Pune",
  state: "Maharashtra",
  job_title: "Principal",
  sport: "Football",
  area_sqft: 1200,
  length_ft: 40,
  width_ft: 30,
  start_when: "Immediately",
  notes: "Need it before monsoon",
  answers: [{ key: "courts", label: "How many courts?", value: "2" }],
  surface: "Turf",
  env: "school",
  source: "fitoverse.com/build",
  userAgent: "Mozilla/5.0",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  pending.length = 0;
  db.metaLeadStage.findFirst.mockResolvedValue({ slug: "NEW" });
  db.websiteLead.create.mockImplementation(async ({ data }: { data: { name: string; city: string | null; sport: string | null } }) => ({
    id: "our-uuid-1",
    name: data.name,
    city: data.city,
    sport: data.sport,
  }));
  db.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "mgr-1" }]);
  push.sendPushToUser.mockResolvedValue(undefined);
});

describe("webhook secret", () => {
  const key = generateWebsiteLeadKey();

  it("keyMatchesHash: missing key, missing hash and a wrong key are refused; the right key passes", () => {
    const hash = hashWebsiteLeadKey(key);
    expect(keyMatchesHash(undefined, hash)).toBe(false);
    expect(keyMatchesHash("", hash)).toBe(false);
    expect(keyMatchesHash(key, undefined)).toBe(false);
    expect(keyMatchesHash(key, "")).toBe(false);
    expect(keyMatchesHash(`${key}x`, hash)).toBe(false);
    expect(keyMatchesHash(generateWebsiteLeadKey(), hash)).toBe(false);
    expect(keyMatchesHash(key, "not-hex")).toBe(false);
    expect(keyMatchesHash(key, hash)).toBe(true);
  });

  it("stores only a sha256 hash, never the secret", () => {
    const hash = hashWebsiteLeadKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
  });

  it("isValidIncomingKey reads the hash from the Setting table", async () => {
    db.setting.findUnique.mockResolvedValue({ value: hashWebsiteLeadKey(key) });
    expect(await isValidIncomingKey(key)).toBe(true);
    expect(db.setting.findUnique).toHaveBeenCalledWith({
      where: { key: WEBSITE_LEAD_KEY_SETTING },
      select: { value: true },
    });
    expect(await isValidIncomingKey("wrong")).toBe(false);
    expect(await isValidIncomingKey(null)).toBe(false);
  });

  it("refuses everything when no secret has been issued yet", async () => {
    db.setting.findUnique.mockResolvedValue(null);
    expect(await isValidIncomingKey(key)).toBe(false);
  });
});

describe("live-site filter", () => {
  it("accepts the live source, with any configurator env or none", () => {
    expect(isLiveWebsiteLead({ source: "fitoverse.com/build", env: "school" })).toBe(true);
    expect(isLiveWebsiteLead({ source: "fitoverse.com/build", env: null })).toBe(true);
    expect(isLiveWebsiteLead({ source: "https://www.Fitoverse.com/build" })).toBe(true);
  });

  it("rejects another or missing source", () => {
    expect(isLiveWebsiteLead({ source: "preview-abc.vercel.app/build" })).toBe(false);
    expect(isLiveWebsiteLead({ source: "localhost:3000/build" })).toBe(false);
    expect(isLiveWebsiteLead({ source: null })).toBe(false);
    expect(isLiveWebsiteLead({})).toBe(false);
  });

  it("rejects test/preview env values and a non-production deployment", () => {
    expect(isLiveWebsiteLead({ source: "fitoverse.com/build", env: "preview" })).toBe(false);
    expect(isLiveWebsiteLead({ source: "fitoverse.com/build", env: "Test" })).toBe(false);
    expect(isLiveWebsiteLead({ source: "fitoverse.com/build", env: "staging" })).toBe(false);
    expect(isLiveWebsiteLead({ source: "fitoverse.com/build", deployment: "preview" })).toBe(false);
    expect(isLiveWebsiteLead({ source: "fitoverse.com/build", deployment: "production" })).toBe(true);
  });

  it("a lead that is not live is acknowledged but never saved or pushed", async () => {
    const r = await ingestWebsiteLead(payload({ source: "preview-abc.vercel.app/build" }));
    expect(r).toEqual({ kind: "ignored" });
    expect(db.websiteLead.create).not.toHaveBeenCalled();
    expect(push.sendPushToUser).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it("accepts a full payload and maps it", () => {
    const r = parseWebsiteLeadPayload(payload());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead).toMatchObject({
        id: "6f1f3a52-0e0b-4c8e-9b57-1f2a3b4c5d6e",
        name: "Asha Rao",
        phone: "+919876543210",
        city: "Pune",
        area_sqft: 1200,
        answers: [{ key: "courts", label: "How many courts?", value: "2" }],
      });
    }
  });

  it("requires id, name and phone", () => {
    expect(parseWebsiteLeadPayload(payload({ phone: undefined })).ok).toBe(false);
    expect(parseWebsiteLeadPayload(payload({ phone: "   " })).ok).toBe(false);
    expect(parseWebsiteLeadPayload(payload({ name: "" })).ok).toBe(false);
    expect(parseWebsiteLeadPayload(payload({ id: undefined })).ok).toBe(false);
    expect(parseWebsiteLeadPayload(payload({ phone: "1".repeat(41) })).ok).toBe(false);
  });

  it("rejects bodies that are not an object", () => {
    expect(parseWebsiteLeadPayload(null).ok).toBe(false);
    expect(parseWebsiteLeadPayload("lead").ok).toBe(false);
    expect(parseWebsiteLeadPayload([payload()]).ok).toBe(false);
  });

  it("never loses a lead over optional fields: long text is cut, junk becomes null", () => {
    const r = parseWebsiteLeadPayload(
      payload({ notes: "n".repeat(9000), email: 42, city: { x: 1 }, area_sqft: "abc", length_ft: "1,200", width_ft: -5, answers: "nope" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead.notes).toHaveLength(5000);
      expect(r.lead.email).toBe("42");
      expect(r.lead.city).toBeNull();
      expect(r.lead.area_sqft).toBeNull();
      expect(r.lead.length_ft).toBe(1200);
      expect(r.lead.width_ft).toBeNull();
      expect(r.lead.answers).toEqual([]);
    }
  });

  it("keeps only usable custom answers, capped at 100", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ key: `q${i}`, label: `Q${i}`, value: `a${i}` }));
    const r = parseWebsiteLeadPayload(payload({ answers: [{ key: "a", label: "A", value: "" }, null, ...many] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lead.answers.length).toBeLessThanOrEqual(100);
  });

  it("an unreadable receivedAt falls back to now", () => {
    const r = parseWebsiteLeadPayload(payload({ receivedAt: "yesterday-ish" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.lead.receivedAt.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("an invalid payload is reported, not saved", async () => {
    expect(await ingestWebsiteLead({ id: "x" })).toEqual({ kind: "invalid" });
    expect(db.websiteLead.create).not.toHaveBeenCalled();
  });
});

describe("saving and dedupe", () => {
  it("saves a live lead with the normalised phone and the first stage", async () => {
    db.metaLeadStage.findFirst.mockResolvedValue({ slug: "FRESH" });
    const r = await ingestWebsiteLead(payload());
    expect(r).toEqual({ kind: "created", id: "our-uuid-1" });
    const data = db.websiteLead.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      websiteLeadId: "6f1f3a52-0e0b-4c8e-9b57-1f2a3b4c5d6e",
      name: "Asha Rao",
      phone: "+919876543210",
      normalizedPhone: "919876543210",
      jobTitle: "Principal",
      areaSqft: 1200,
      lengthFt: 40,
      widthFt: 30,
      startWhen: "Immediately",
      env: "school",
      source: "fitoverse.com/build",
      stage: "FRESH",
    });
    expect(db.metaLeadStage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, isActive: true }, orderBy: { sortOrder: "asc" } }),
    );
  });

  it("falls back to NEW when there is no stage list", async () => {
    db.metaLeadStage.findFirst.mockResolvedValue(null);
    await ingestWebsiteLead(payload());
    expect(db.websiteLead.create.mock.calls[0][0].data.stage).toBe("NEW");
  });

  it("the same website lead id twice is one row, and the second still succeeds", async () => {
    const rows = new Set<string>();
    db.websiteLead.create.mockImplementation(async ({ data }: { data: { websiteLeadId: string; name: string } }) => {
      if (rows.has(data.websiteLeadId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      rows.add(data.websiteLeadId);
      return { id: "our-uuid-1", name: data.name, city: null, sport: null };
    });
    expect((await ingestWebsiteLead(payload())).kind).toBe("created");
    expect(await ingestWebsiteLead(payload())).toEqual({ kind: "duplicate" });
    expect(rows.size).toBe(1);
    await Promise.all(pending);
    // only the first one notified anyone
    expect(push.sendPushToUser).toHaveBeenCalledTimes(2);
  });

  it("other database errors are not swallowed", async () => {
    db.websiteLead.create.mockRejectedValue(new Error("connection lost"));
    await expect(ingestWebsiteLead(payload())).rejects.toThrow("connection lost");
  });
});

describe("notification", () => {
  it("pushes to active, approved admins and managers", async () => {
    await ingestWebsiteLead(payload());
    await Promise.all(pending);
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: {
        role: { in: ["admin", "manager"] },
        isActive: true,
        deletedAt: null,
        approvalStatus: "approved",
        pushEnabled: true,
      },
      select: { id: true },
    });
    expect(push.sendPushToUser).toHaveBeenCalledTimes(2);
    expect(push.sendPushToUser).toHaveBeenCalledWith("admin-1", {
      title: "New website lead",
      body: "Asha Rao · Pune · Football",
      url: "/website-leads/our-uuid-1",
      tag: "website-lead-our-uuid-1",
    });
  });

  it("leaves out missing parts of the body", () => {
    expect(websiteLeadPushBody({ name: "Asha", city: null, sport: "Tennis" })).toBe("Asha · Tennis");
    expect(websiteLeadPushBody({ name: "Asha", city: "", sport: null })).toBe("Asha");
  });

  it("a failing push never breaks the webhook", async () => {
    push.sendPushToUser.mockRejectedValue(new Error("push service down"));
    expect((await ingestWebsiteLead(payload())).kind).toBe("created");
    await expect(Promise.all(pending)).resolves.toBeDefined();
    db.user.findMany.mockRejectedValue(new Error("db down"));
    pending.length = 0;
    await ingestWebsiteLead(payload({ id: "another-id" }));
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Attribution (where the visitor came from), sent by newer versions of the website
// ---------------------------------------------------------------------------

const attribution = (over: Record<string, unknown> = {}) => ({
  referrer: "https://chatgpt.com/",
  landing_page: "/build",
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_term: null,
  utm_content: null,
  click_id: null,
  first_seen_at: "2026-10-26T10:00:00.000Z",
  ...over,
});

const created = () => db.websiteLead.create.mock.calls[0][0].data;

describe("sanitizeAttribution", () => {
  it("keeps a clean attribution as it is", () => {
    const full = attribution({
      referrer: "https://www.google.com/search",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "turf-oct",
      utm_term: "football turf",
      utm_content: "ad-1",
      click_id: "gclid",
    });
    expect(sanitizeAttribution(full)).toEqual(full);
  });

  it("keeps only the referrer's site and path, never its query string or #fragment", () => {
    const a = sanitizeAttribution(attribution({ referrer: "https://www.google.com/search?q=turf&phone=98765#top" }));
    expect(a?.referrer).toBe("https://www.google.com/search");
  });

  it("gives null when the website sent no attribution object", () => {
    for (const v of [undefined, null, "", "chatgpt", 5, true, [], [attribution()], {}, { something: "else" }]) {
      expect(sanitizeAttribution(v), JSON.stringify(v)).toBeNull();
    }
  });

  it("an object whose fields are all null is still an attribution (a direct visit)", () => {
    expect(sanitizeAttribution({ referrer: null, landing_page: null, click_id: null })).toEqual({
      referrer: null,
      landing_page: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
      click_id: null,
      first_seen_at: null,
    });
  });

  it("the referrer must be an http(s) URL, and is cut at 500 characters", () => {
    for (const referrer of ["chatgpt.com", "javascript:alert(1)", "android-app://com.google.android.gm", "ftp://x.com", "", 7, {}, "https://"]) {
      expect(sanitizeAttribution(attribution({ referrer }))?.referrer, String(referrer)).toBeNull();
    }
    expect(sanitizeAttribution(attribution({ referrer: "  https://claude.ai/chat/1  " }))?.referrer).toBe("https://claude.ai/chat/1");
    expect(sanitizeAttribution(attribution({ referrer: `https://example.com/${"a".repeat(900)}` }))?.referrer).toHaveLength(500);
  });

  it("the landing page is a path without a query string, at most 300 characters", () => {
    const page = (landing_page: unknown) => sanitizeAttribution(attribution({ landing_page }))?.landing_page;
    expect(page("/build?utm_source=x#top")).toBe("/build");
    expect(page("https://fitoverse.com/build/step-2?x=1")).toBe("/build/step-2");
    expect(page("/")).toBe("/");
    expect(page("build")).toBeNull();
    expect(page("")).toBeNull();
    expect(page(12)).toBeNull();
    expect(page(`/${"p".repeat(500)}`)).toHaveLength(300);
  });

  it("utm values are trimmed text, at most 150 characters; junk becomes null", () => {
    const a = sanitizeAttribution(
      attribution({ utm_source: "  Newsletter ", utm_medium: "email", utm_campaign: "c".repeat(400), utm_term: 42, utm_content: { a: 1 } }),
    );
    expect(a?.utm_source).toBe("Newsletter");
    expect(a?.utm_campaign).toHaveLength(150);
    expect(a?.utm_term).toBe("42");
    expect(a?.utm_content).toBeNull();
  });

  it("only the five known click ids pass, and only their names", () => {
    for (const id of ["gclid", "fbclid", "msclkid", "ttclid", "li_fat_id"]) {
      expect(sanitizeAttribution(attribution({ click_id: id }))?.click_id).toBe(id);
    }
    expect(sanitizeAttribution(attribution({ click_id: " GCLID " }))?.click_id).toBe("gclid");
    for (const click_id of ["EAIaIQobChMI-real-click-value", "dclid", "", null, 3, ["gclid"]]) {
      expect(sanitizeAttribution(attribution({ click_id }))?.click_id, String(click_id)).toBeNull();
    }
  });

  it("first_seen_at must be a believable time, stored as ISO", () => {
    const seen = (first_seen_at: unknown) => sanitizeAttribution(attribution({ first_seen_at }))?.first_seen_at;
    expect(seen("2026-10-26T15:30:00+05:30")).toBe("2026-10-26T10:00:00.000Z");
    expect(seen("last tuesday")).toBeNull();
    expect(seen("2001-01-01T00:00:00Z")).toBeNull();
    expect(seen(new Date(Date.now() + 5 * 86_400_000).toISOString())).toBeNull();
    expect(seen(null)).toBeNull();
  });
});

describe("attributionColumns", () => {
  it("is all null without attribution (shown as Unknown, never guessed)", () => {
    expect(attributionColumns(null)).toEqual({ cameFrom: null, cameFromGroup: null, landingPage: null, attribution: null });
  });

  it("classifies and keeps the sanitized JSON", () => {
    const a = sanitizeAttribution(attribution())!;
    const cols = attributionColumns(a);
    expect(cols).toMatchObject({ cameFrom: "ChatGPT", cameFromGroup: "AI assistants", landingPage: "/build" });
    expect(JSON.parse(cols.attribution!)).toEqual(a);
  });

  it.each([
    [{ referrer: "https://www.google.com/" }, "Google search", "Search"],
    [{ referrer: "https://l.instagram.com/?u=x" }, "Instagram", "Social"],
    [{ referrer: "https://www.bing.com/chat?q=x" }, "Copilot", "AI assistants"],
    [{ referrer: "https://www.bing.com/search?q=x" }, "Bing", "Search"],
    [{ referrer: "https://blog.example.com/post" }, "Other website", "Other websites"],
    [{ referrer: null }, "Direct", "Direct"],
    [{ referrer: null, click_id: "gclid" }, "Google Ads", "Paid ads"],
    [{ referrer: "https://www.google.com/", utm_source: "google", utm_medium: "cpc" }, "Google Ads", "Paid ads"],
    [{ referrer: null, utm_source: "facebook", utm_medium: "paid_social" }, "Meta Ads", "Paid ads"],
    [{ referrer: null, utm_source: "newsletter", utm_medium: "email" }, "Email", "Email"],
    [{ referrer: "https://www.google.com/", utm_source: "perplexity" }, "Perplexity", "AI assistants"],
  ])("%j -> %s / %s", (over, label, group) => {
    expect(attributionColumns(sanitizeAttribution(attribution(over)))).toMatchObject({ cameFrom: label, cameFromGroup: group });
  });
});

describe("ingesting attribution", () => {
  it("stores where the lead came from, the landing page and the attribution JSON", async () => {
    const r = await ingestWebsiteLead(
      payload({ attribution: attribution({ referrer: "https://www.google.com/", utm_campaign: "turf-oct" }) }),
    );
    expect(r).toEqual({ kind: "created", id: "our-uuid-1" });
    expect(created()).toMatchObject({ cameFrom: "Google search", cameFromGroup: "Search", landingPage: "/build" });
    expect(JSON.parse(created().attribution)).toMatchObject({ referrer: "https://www.google.com/", utm_campaign: "turf-oct" });
  });

  it("an old website (no attribution) still works: the four columns are null", async () => {
    const r = await ingestWebsiteLead(payload());
    expect(r).toEqual({ kind: "created", id: "our-uuid-1" });
    expect(created()).toMatchObject({ cameFrom: null, cameFromGroup: null, landingPage: null, attribution: null });
  });

  it("never refuses a lead because of bad attribution: the bad parts are dropped", async () => {
    for (const bad of ["oops", 42, [1, 2], { referrer: "javascript:alert(1)", click_id: "EAIa-real-value", landing_page: 9, utm_source: { x: 1 } }]) {
      db.websiteLead.create.mockClear();
      expect(await ingestWebsiteLead(payload({ attribution: bad })), JSON.stringify(bad)).toEqual({ kind: "created", id: "our-uuid-1" });
      expect(created().name).toBe("Asha Rao");
    }
    // The last one was an attribution object with nothing usable in it: a visit with no known source.
    expect(created()).toMatchObject({ cameFrom: "Direct", landingPage: null });
    expect(JSON.parse(created().attribution)).toMatchObject({ referrer: null, click_id: null });
  });

  it("the stored attribution never holds a click id value", async () => {
    await ingestWebsiteLead(payload({ attribution: attribution({ referrer: null, click_id: "gclid", gclid: "EAIaIQobChMI-secret-value" }) }));
    expect(created().attribution).not.toContain("EAIaIQ");
    expect(created().cameFrom).toBe("Google Ads");
  });

  it("is also parsed with the rest of the payload", () => {
    const r = parseWebsiteLeadPayload(payload({ attribution: attribution() }));
    expect(r.ok && r.lead.attribution).toMatchObject({ referrer: "https://chatgpt.com/", landing_page: "/build" });
    const old = parseWebsiteLeadPayload(payload());
    expect(old.ok && old.lead.attribution).toBeNull();
  });
});
