/**
 * Google client tests, entirely against mocked HTTP.
 *
 * There is no API key yet — the client is awaiting Google Cloud billing
 * approval — so every one of these runs without a network. That is not a
 * compromise: retry behaviour, circuit breaking and header construction are
 * far easier to assert against a fake than against a live quota.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CircuitOpenError,
  GoogleApiError,
  GoogleClient,
  type CallLog,
} from "./googleClient";

const CENTRE = { lat: 12.9784, lng: 77.6408 };

interface StubCall {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** A fetch stub that records calls and replays a queued script of responses. */
function stubFetch(script: Array<{ status: number; body: unknown }>) {
  const calls: StubCall[] = [];
  let index = 0;

  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(url),
      init,
      headers,
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    return {
      ok: step!.status >= 200 && step!.status < 300,
      status: step!.status,
      json: async () => step!.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { impl, calls, get count() { return index; } };
}

function client(
  script: Array<{ status: number; body: unknown }>,
  extra: { logger?: (log: CallLog) => void; now?: () => number } = {},
) {
  const fetchStub = stubFetch(script);
  const instance = new GoogleClient({
    apiKey: "test-key",
    fetchImpl: fetchStub.impl,
    // No real sleeping: the retry tests would otherwise take seconds.
    sleep: async () => undefined,
    logger: extra.logger ?? (() => undefined),
    now: extra.now,
  });
  return { instance, fetchStub };
}

const OK_SEARCH = {
  status: 200,
  body: { places: [{ id: "ChIJa", displayName: { text: "A" }, location: { latitude: 12.9, longitude: 77.6 } }] },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  delete process.env.PLACES_TEXT_LOCATION_RESTRICTION;
  delete process.env.PLACES_MAX_RETRIES;
  delete process.env.PLACES_CIRCUIT_FAILURE_THRESHOLD;
});

describe("searchNearby", () => {
  it("sends a circular locationRestriction, which is a hard boundary", () => {
    const { instance, fetchStub } = client([OK_SEARCH]);
    return instance
      .searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" })
      .then(() => {
        const body = fetchStub.calls[0]!.body!;
        expect(body.locationRestriction).toEqual({
          circle: { center: { latitude: CENTRE.lat, longitude: CENTRE.lng }, radius: 800 },
        });
        expect(body.includedTypes).toEqual(["gym"]);
        expect(body.maxResultCount).toBe(20);
      });
  });

  it("authenticates by header and never by query string", async () => {
    const { instance, fetchStub } = client([OK_SEARCH]);
    await instance.searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" });
    expect(fetchStub.calls[0]!.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(fetchStub.calls[0]!.url).not.toContain("test-key");
  });

  it("sends the field mask for the requested tier", async () => {
    const { instance, fetchStub } = client([OK_SEARCH]);
    await instance.searchNearby({
      centre: CENTRE,
      radiusM: 800,
      includedTypes: ["gym"],
      tier: "ENTERPRISE_ATMOSPHERE",
    });
    expect(fetchStub.calls[0]!.headers["X-Goog-FieldMask"]).toContain("places.reviews");
  });

  it("counts as exactly one billable call", async () => {
    const { instance } = client([OK_SEARCH]);
    const result = await instance.searchNearby({
      centre: CENTRE,
      radiusM: 800,
      includedTypes: ["gym"],
      tier: "PRO",
    });
    expect(result.calls).toBe(1);
    expect(result.places).toHaveLength(1);
  });

  it("returns an empty array when Google sends no places key at all", async () => {
    const { instance } = client([{ status: 200, body: {} }]);
    const result = await instance.searchNearby({
      centre: CENTRE,
      radiusM: 800,
      includedTypes: ["gym"],
      tier: "PRO",
    });
    expect(result.places).toEqual([]);
  });
});

describe("searchText", () => {
  it("sends a rectangular locationRestriction that circumscribes the tile", async () => {
    // Text Search accepts a rectangle and not a circle, so the tile circle is
    // boxed and results are distance-filtered afterwards.
    const { instance, fetchStub } = client([OK_SEARCH]);
    await instance.searchText({
      centre: CENTRE,
      radiusM: 800,
      textQuery: "box cricket",
      tier: "ENTERPRISE_ATMOSPHERE",
    });
    const body = fetchStub.calls[0]!.body!;
    const rect = (body.locationRestriction as { rectangle: { low: { lat: number }; high: { lat: number } } })
      .rectangle;
    expect(rect.low.lat ?? (rect.low as unknown as { latitude: number }).latitude).toBeLessThan(
      CENTRE.lat,
    );
    expect(body.locationBias).toBeUndefined();
    expect(body.textQuery).toBe("box cricket");
    expect(body.pageSize).toBe(20);
  });

  it("falls back to a circular locationBias when Google rejects the restriction", async () => {
    // The docs limit Text Search `locationRestriction` to categorical queries.
    // If that reading is wrong for a term, the scan degrades to v16's bias
    // behaviour rather than failing.
    const { instance, fetchStub } = client([
      { status: 400, body: { error: { status: "INVALID_ARGUMENT", message: "locationRestriction not supported" } } },
      OK_SEARCH,
    ]);
    const result = await instance.searchText({
      centre: CENTRE,
      radiusM: 800,
      textQuery: "box cricket",
      tier: "PRO",
    });
    expect(result.places).toHaveLength(1);
    expect(fetchStub.calls[1]!.body!.locationBias).toEqual({
      circle: { center: { latitude: CENTRE.lat, longitude: CENTRE.lng }, radius: 800 },
    });
  });

  it("uses locationBias directly when the restriction is switched off", async () => {
    process.env.PLACES_TEXT_LOCATION_RESTRICTION = "false";
    const { instance, fetchStub } = client([OK_SEARCH]);
    await instance.searchText({ centre: CENTRE, radiusM: 800, textQuery: "turf", tier: "PRO" });
    expect(fetchStub.calls[0]!.body!.locationBias).toBeDefined();
    expect(fetchStub.calls[0]!.body!.locationRestriction).toBeUndefined();
  });

  it("asks for nextPageToken so pagination is possible", async () => {
    const { instance, fetchStub } = client([OK_SEARCH]);
    await instance.searchText({ centre: CENTRE, radiusM: 800, textQuery: "turf", tier: "PRO" });
    expect(fetchStub.calls[0]!.headers["X-Goog-FieldMask"]).toContain("nextPageToken");
  });

  it("does not re-shape a 400 that is not about the location restriction", async () => {
    const { instance } = client([
      { status: 400, body: { error: { status: "INVALID_REQUEST", message: "bad field mask" } } },
    ]);
    await expect(
      instance.searchText({ centre: CENTRE, radiusM: 800, textQuery: "turf", tier: "PRO" }),
    ).rejects.toThrow(/bad field mask/);
  });
});

describe("searchTextPaged", () => {
  const page = (ids: string[], next?: string) => ({
    status: 200,
    body: {
      places: ids.map((id) => ({ id, location: { latitude: 12.9, longitude: 77.6 } })),
      ...(next ? { nextPageToken: next } : {}),
    },
  });

  it("follows page tokens and bills every page", async () => {
    const { instance, fetchStub } = client([
      page(["a", "b"], "tok1"),
      page(["c", "d"], "tok2"),
      page(["e"]),
    ]);
    const result = await instance.searchTextPaged(
      { centre: CENTRE, radiusM: 800, textQuery: "turf", tier: "PRO" },
      3,
    );
    expect(result.places.map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
    // Three pages is three billable calls, and the cost meter must see three.
    expect(result.calls).toBe(3);
    expect(fetchStub.calls[1]!.body!.pageToken).toBe("tok1");
    expect(fetchStub.calls[2]!.body!.pageToken).toBe("tok2");
  });

  it("stops at maxPages and reports the token it did not follow", async () => {
    // A surviving token is what tells the pipeline the tile was truncated.
    const { instance } = client([page(["a"], "tok1"), page(["b"], "tok2"), page(["c"], "tok3")]);
    const result = await instance.searchTextPaged(
      { centre: CENTRE, radiusM: 800, textQuery: "turf", tier: "PRO" },
      2,
    );
    expect(result.calls).toBe(2);
    expect(result.nextPageToken).toBe("tok2");
  });

  it("stops early when Google offers no further page", async () => {
    const { instance, fetchStub } = client([page(["a"])]);
    const result = await instance.searchTextPaged(
      { centre: CENTRE, radiusM: 800, textQuery: "turf", tier: "PRO" },
      3,
    );
    expect(result.calls).toBe(1);
    expect(fetchStub.count).toBe(1);
  });
});

describe("retry", () => {
  it("retries a 429 and succeeds", async () => {
    const logs: CallLog[] = [];
    const { instance, fetchStub } = client(
      [{ status: 429, body: { error: { message: "rate limited" } } }, OK_SEARCH],
      { logger: (l) => logs.push(l) },
    );
    const result = await instance.searchNearby({
      centre: CENTRE,
      radiusM: 800,
      includedTypes: ["gym"],
      tier: "PRO",
    });
    expect(result.places).toHaveLength(1);
    expect(fetchStub.count).toBe(2);
    expect(logs[0]!.outcome).toBe("retried");
    expect(logs[0]!.attempts).toBe(2);
  });

  it("retries a 503", async () => {
    const { instance, fetchStub } = client([{ status: 503, body: {} }, OK_SEARCH]);
    await instance.searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" });
    expect(fetchStub.count).toBe(2);
  });

  it("does not retry a 400 — a bad field mask fails identically three times", async () => {
    const { instance, fetchStub } = client([
      { status: 400, body: { error: { status: "INVALID_REQUEST", message: "unknown field" } } },
    ]);
    await expect(
      instance.searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" }),
    ).rejects.toBeInstanceOf(GoogleApiError);
    expect(fetchStub.count).toBe(1);
  });

  it("gives up after the configured number of retries", async () => {
    process.env.PLACES_MAX_RETRIES = "2";
    const { instance, fetchStub } = client([{ status: 500, body: {} }]);
    await expect(
      instance.searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" }),
    ).rejects.toBeInstanceOf(GoogleApiError);
    expect(fetchStub.count).toBe(3); // initial attempt plus two retries
  });

  it("retries a transport failure with no HTTP response", async () => {
    let calls = 0;
    const instance = new GoogleClient({
      apiKey: "k",
      sleep: async () => undefined,
      logger: () => undefined,
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("network down");
        return { ok: true, status: 200, json: async () => ({ places: [] }) } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    await expect(
      instance.searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" }),
    ).resolves.toMatchObject({ places: [] });
    expect(calls).toBe(2);
  });
});

describe("circuit breaker", () => {
  it("opens after repeated failures and refuses further calls immediately", async () => {
    // The scenario this exists for: Google is down, the scan has sixty tiles
    // left, and each one would otherwise sit there timing out.
    process.env.PLACES_MAX_RETRIES = "0";
    process.env.PLACES_CIRCUIT_FAILURE_THRESHOLD = "3";

    const { instance, fetchStub } = client([{ status: 500, body: {} }]);
    const call = () =>
      instance.searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" });

    await expect(call()).rejects.toBeInstanceOf(GoogleApiError);
    await expect(call()).rejects.toBeInstanceOf(GoogleApiError);
    await expect(call()).rejects.toBeInstanceOf(GoogleApiError);

    expect(instance.isCircuitOpen()).toBe(true);
    const before = fetchStub.count;
    await expect(call()).rejects.toBeInstanceOf(CircuitOpenError);
    // The point: no HTTP was attempted at all.
    expect(fetchStub.count).toBe(before);
  });

  it("closes again once the reset window passes", async () => {
    process.env.PLACES_MAX_RETRIES = "0";
    process.env.PLACES_CIRCUIT_FAILURE_THRESHOLD = "1";

    let clock = 1_000_000;
    const { instance } = client([{ status: 500, body: {} }], { now: () => clock });
    const call = () =>
      instance.searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" });

    await expect(call()).rejects.toBeInstanceOf(GoogleApiError);
    expect(instance.isCircuitOpen()).toBe(true);

    clock += 60_000;
    expect(instance.isCircuitOpen()).toBe(false);
  });

  it("resets the failure count on any success, so intermittent errors never trip it", async () => {
    process.env.PLACES_MAX_RETRIES = "0";
    process.env.PLACES_CIRCUIT_FAILURE_THRESHOLD = "3";

    const { instance } = client([
      { status: 500, body: {} },
      OK_SEARCH,
      { status: 500, body: {} },
      { status: 500, body: {} },
    ]);
    const call = () =>
      instance.searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" });

    await expect(call()).rejects.toBeInstanceOf(GoogleApiError);
    await call();
    await expect(call()).rejects.toBeInstanceOf(GoogleApiError);
    await expect(call()).rejects.toBeInstanceOf(GoogleApiError);
    expect(instance.isCircuitOpen()).toBe(false);
  });
});

describe("logging", () => {
  it("logs endpoint, tier, latency and result count for a successful call", async () => {
    const logs: CallLog[] = [];
    const { instance } = client([OK_SEARCH], { logger: (l) => logs.push(l) });
    await instance.searchNearby({
      centre: CENTRE,
      radiusM: 800,
      includedTypes: ["gym"],
      tier: "ENTERPRISE",
    });
    expect(logs[0]).toMatchObject({
      endpoint: "searchNearby",
      skuTier: "ENTERPRISE",
      outcome: "ok",
      resultCount: 1,
      cacheHit: false,
    });
    expect(logs[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("logs a failure with its HTTP status", async () => {
    process.env.PLACES_MAX_RETRIES = "0";
    const logs: CallLog[] = [];
    const { instance } = client([{ status: 403, body: { error: { message: "denied" } } }], {
      logger: (l) => logs.push(l),
    });
    await expect(
      instance.searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" }),
    ).rejects.toThrow();
    expect(logs[0]).toMatchObject({ outcome: "failed", httpStatus: 403 });
  });
});

describe("geocoding", () => {
  it("authenticates by query parameter, as the Geocoding API requires", async () => {
    const { instance, fetchStub } = client([{ status: 200, body: { status: "OK", results: [] } }]);
    await instance.geocode("Indiranagar, Bengaluru");
    expect(fetchStub.calls[0]!.url).toContain("key=test-key");
    expect(fetchStub.calls[0]!.headers["X-Goog-Api-Key"]).toBeUndefined();
  });

  it("reverse geocodes a pin back to an address", async () => {
    const { instance, fetchStub } = client([{ status: 200, body: { status: "OK", results: [] } }]);
    await instance.reverseGeocode(CENTRE);
    expect(fetchStub.calls[0]!.url).toContain(`latlng=${CENTRE.lat}%2C${CENTRE.lng}`);
  });
});

describe("missing key", () => {
  it("fails with an actionable message rather than a 403 from Google", async () => {
    const instance = new GoogleClient({ fetchImpl: stubFetch([OK_SEARCH]).impl });
    const previous = process.env.GOOGLE_MAPS_SERVER_KEY;
    process.env.GOOGLE_MAPS_SERVER_KEY = "PASTE_HERE";
    try {
      await expect(
        instance.searchNearby({ centre: CENTRE, radiusM: 800, includedTypes: ["gym"], tier: "PRO" }),
      ).rejects.toThrow(/GOOGLE_MAPS_SERVER_KEY is not set/);
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_MAPS_SERVER_KEY;
      else process.env.GOOGLE_MAPS_SERVER_KEY = previous;
    }
  });
});
