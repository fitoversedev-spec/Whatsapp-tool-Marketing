/**
 * Server-side Google client.
 *
 * The only module in the codebase that holds the Places key, and the only one
 * that talks to Google. It is a plain module rather than a route handler so a
 * background worker can use it without pretending to be an HTTP request.
 *
 * Four responsibilities:
 *
 * 1. **Typed wrappers** over `searchNearby`, `searchText`, `places/{id}` and
 *    Geocoding, each carrying the field mask that decides its price.
 * 2. **Retry with exponential backoff and jitter** on 429 and 5xx. Places
 *    rate-limits under a tiled sweep and a bare failure loses a whole tile.
 * 3. **A circuit breaker.** If Google is down, a scan of 64 tiles must not sit
 *    there timing out 64 times — it must fail immediately and loudly. A dead
 *    API cannot be allowed to hang the UI.
 * 4. **Structured logging of every call** — endpoint, SKU tier, latency, retry
 *    count, cache class — which is what makes the cost meter and the handoff's
 *    measured numbers possible.
 *
 * `fetch` is injectable so the whole thing is testable without a key, which
 * matters: there is no key yet.
 */

import "server-only";

import { boundingBox, type LatLng } from "@/lib/scout/geo/distance";
import { env } from "@/lib/scout/env";

import {
  GOOGLE_GEOCODE_BASE_URL,
  GOOGLE_PLACES_BASE_URL,
  NEARBY_MAX_RESULTS,
  placesConfig,
  TEXT_PAGE_SIZE,
} from "./config";
import { detailsFieldMask, searchFieldMask, skuTierForFields } from "./fieldMasks";
import type {
  GeocodeResponse,
  GoogleErrorBody,
  GooglePlace,
  GoogleSearchResponse,
} from "./googleTypes";
import type { SkuTier } from "./taxonomy";

/* ------------------------------------------------------------------ types */

export type CallOutcome = "ok" | "retried" | "failed" | "circuit-open" | "cache";

export interface CallLog {
  readonly endpoint: "searchNearby" | "searchText" | "placeDetails" | "geocode";
  readonly skuTier: SkuTier | "GEOCODING";
  readonly outcome: CallOutcome;
  readonly latencyMs: number;
  readonly attempts: number;
  readonly httpStatus?: number;
  readonly resultCount?: number;
  /** Set when the result was served from our own cache and cost nothing. */
  readonly cacheHit: boolean;
  readonly error?: string;
}

export type CallLogger = (log: CallLog) => void;

export interface GoogleClientOptions {
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: CallLogger;
  /** Injectable for tests; production sleeps for real. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly googleStatus?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export class CircuitOpenError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(
      `Google Places is failing repeatedly; the circuit is open for another ${Math.ceil(
        retryAfterMs / 1000,
      )} s. No further calls will be attempted until it closes.`,
    );
    this.name = "CircuitOpenError";
  }
}

export interface SearchNearbyRequest {
  readonly centre: LatLng;
  readonly radiusM: number;
  readonly includedTypes: readonly string[];
  readonly tier: SkuTier;
  readonly maxResultCount?: number;
}

export interface SearchTextRequest {
  readonly centre: LatLng;
  readonly radiusM: number;
  readonly textQuery: string;
  readonly tier: SkuTier;
  readonly pageToken?: string;
  readonly pageSize?: number;
}

export interface SearchResult {
  readonly places: GooglePlace[];
  readonly nextPageToken?: string;
  /** Billable calls this result consumed. Text pagination makes this > 1. */
  readonly calls: number;
  readonly tier: SkuTier;
}

/* ------------------------------------------------------------- the client */

export class GoogleClient {
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: CallLogger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  /** Consecutive failures. Reset by any success. */
  private consecutiveFailures = 0;
  /** Epoch ms until which the circuit stays open. */
  private circuitOpenUntil = 0;

  constructor(options: GoogleClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.logger = options.logger ?? defaultLogger;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
  }

  /**
   * Resolved lazily so the module can be imported — and the app built — with
   * no key present. Phases 2–8 must stay buildable while the client waits for
   * Google Cloud billing approval.
   */
  private key(): string {
    const key = this.apiKey ?? env.googleMapsServerKey;
    if (!key) {
      throw new GoogleApiError(
        "GOOGLE_MAPS_SERVER_KEY is not set. Add it to .env.local; it must never be exposed to the browser.",
        0,
        "NO_API_KEY",
        false,
      );
    }
    return key;
  }

  /** True when the API is considered dead and calls are being refused. */
  isCircuitOpen(): boolean {
    return this.now() < this.circuitOpenUntil;
  }

  /* ------------------------------------------------------------ endpoints */

  /**
   * Nearby Search. Takes a **circular** `locationRestriction`, which is a hard
   * boundary — results are inside the tile by construction. Caps at 20 results
   * with no pagination (V1), so hitting exactly `maxResultCount` means the
   * tile may be truncated and must be flagged saturated.
   */
  async searchNearby(request: SearchNearbyRequest): Promise<SearchResult> {
    const body = {
      includedTypes: [...request.includedTypes],
      maxResultCount: request.maxResultCount ?? NEARBY_MAX_RESULTS,
      rankPreference: "DISTANCE",
      languageCode: placesConfig.languageCode,
      regionCode: placesConfig.regionCode,
      locationRestriction: {
        circle: {
          center: { latitude: request.centre.lat, longitude: request.centre.lng },
          radius: request.radiusM,
        },
      },
    };

    const response = await this.post<GoogleSearchResponse>(
      "searchNearby",
      `${GOOGLE_PLACES_BASE_URL}/places:searchNearby`,
      body,
      searchFieldMask(request.tier),
      request.tier,
    );

    return { places: response.places ?? [], calls: 1, tier: request.tier };
  }

  /**
   * Text Search, one page.
   *
   * `locationRestriction` on this endpoint accepts a **rectangle only** (V2),
   * so the tile circle is circumscribed by a box and the caller filters by
   * true geodesic distance afterwards. If Google rejects the restriction —
   * the docs say it is limited to categorical queries — this transparently
   * retries once with a circular `locationBias`, which is what v16 used. A
   * wrong reading of V2 therefore costs precision, not the scan.
   */
  async searchText(request: SearchTextRequest): Promise<SearchResult> {
    const build = (useRestriction: boolean) => {
      const base: Record<string, unknown> = {
        textQuery: request.textQuery,
        pageSize: request.pageSize ?? TEXT_PAGE_SIZE,
        languageCode: placesConfig.languageCode,
        regionCode: placesConfig.regionCode,
      };
      if (request.pageToken) base.pageToken = request.pageToken;

      if (useRestriction) {
        const box = boundingBox(request.centre, request.radiusM);
        base.locationRestriction = {
          rectangle: {
            low: { latitude: box.low.lat, longitude: box.low.lng },
            high: { latitude: box.high.lat, longitude: box.high.lng },
          },
        };
      } else {
        base.locationBias = {
          circle: {
            center: { latitude: request.centre.lat, longitude: request.centre.lng },
            radius: request.radiusM,
          },
        };
      }
      return base;
    };

    const mask = searchFieldMask(request.tier, true);
    const url = `${GOOGLE_PLACES_BASE_URL}/places:searchText`;
    const preferRestriction = placesConfig.textUseLocationRestriction;

    let response: GoogleSearchResponse;
    try {
      response = await this.post<GoogleSearchResponse>(
        "searchText",
        url,
        build(preferRestriction),
        mask,
        request.tier,
      );
    } catch (error) {
      // Only an argument rejection is worth re-shaping; anything else is real.
      if (!preferRestriction || !isLocationRestrictionRejection(error)) throw error;
      response = await this.post<GoogleSearchResponse>(
        "searchText",
        url,
        build(false),
        mask,
        request.tier,
      );
    }

    return {
      places: response.places ?? [],
      nextPageToken: response.nextPageToken,
      calls: 1,
      tier: request.tier,
    };
  }

  /**
   * Text Search, following `nextPageToken` up to `maxPages`.
   *
   * Each page is a separate billable call, so `calls` on the result is what
   * the cost meter records — not one.
   */
  async searchTextPaged(request: SearchTextRequest, maxPages: number): Promise<SearchResult> {
    const places: GooglePlace[] = [];
    let pageToken: string | undefined = request.pageToken;
    let calls = 0;
    let nextPageToken: string | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const result: SearchResult = await this.searchText({ ...request, pageToken });
      calls += result.calls;
      places.push(...result.places);
      nextPageToken = result.nextPageToken;
      if (!nextPageToken) break;
      pageToken = nextPageToken;
    }

    return { places, nextPageToken, calls, tier: request.tier };
  }

  /**
   * Place Details. Note the field mask has **no** `places.` prefix here.
   *
   * Used as a repair path only. Details is billed per *place*, whereas a
   * search is billed per *call* and returns up to 20 places, so enriching a
   * whole catchment through Details costs roughly twenty times more than
   * asking the search for the same fields. The taxonomy sets the tier per
   * category for exactly that reason.
   */
  async placeDetails(placeId: string, tier: SkuTier): Promise<GooglePlace> {
    const bare = placeId.replace(/^places\//, "");
    return this.get<GooglePlace>(
      "placeDetails",
      `${GOOGLE_PLACES_BASE_URL}/places/${encodeURIComponent(bare)}`,
      { "X-Goog-FieldMask": detailsFieldMask(tier) },
      tier,
    );
  }

  /** Forward geocode. Used to turn a typed address into a scan centre. */
  async geocode(address: string): Promise<GeocodeResponse> {
    const url = new URL(GOOGLE_GEOCODE_BASE_URL);
    url.searchParams.set("address", address);
    url.searchParams.set("region", placesConfig.regionCode);
    url.searchParams.set("language", placesConfig.languageCode);
    url.searchParams.set("key", this.key());
    return this.get<GeocodeResponse>("geocode", url.toString(), {}, "GEOCODING");
  }

  /** Reverse geocode. Turns the dropped pin back into a printable address. */
  async reverseGeocode(point: LatLng): Promise<GeocodeResponse> {
    const url = new URL(GOOGLE_GEOCODE_BASE_URL);
    url.searchParams.set("latlng", `${point.lat},${point.lng}`);
    url.searchParams.set("language", placesConfig.languageCode);
    url.searchParams.set("key", this.key());
    return this.get<GeocodeResponse>("geocode", url.toString(), {}, "GEOCODING");
  }

  /* -------------------------------------------------------------- plumbing */

  private post<T>(
    endpoint: CallLog["endpoint"],
    url: string,
    body: unknown,
    fieldMask: string,
    tier: SkuTier,
  ): Promise<T> {
    return this.request<T>(endpoint, url, tier, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.key(),
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
    });
  }

  private get<T>(
    endpoint: CallLog["endpoint"],
    url: string,
    headers: Record<string, string>,
    tier: SkuTier | "GEOCODING",
  ): Promise<T> {
    // Geocoding authenticates by query parameter; Places by header.
    const authHeaders =
      tier === "GEOCODING" ? headers : { ...headers, "X-Goog-Api-Key": this.key() };
    return this.request<T>(endpoint, url, tier, { method: "GET", headers: authHeaders });
  }

  /**
   * One logical call: retry loop, circuit breaker, timeout and logging.
   *
   * The retry only covers transport failures, 429 and 5xx. A 400 means the
   * request is wrong — usually a bad field mask or a place type Table A does
   * not have — and retrying it just spends the budget three times as fast.
   */
  private async request<T>(
    endpoint: CallLog["endpoint"],
    url: string,
    tier: SkuTier | "GEOCODING",
    init: RequestInit,
  ): Promise<T> {
    const started = this.now();

    if (this.isCircuitOpen()) {
      const retryAfterMs = this.circuitOpenUntil - this.now();
      this.logger({
        endpoint,
        skuTier: tier,
        outcome: "circuit-open",
        latencyMs: 0,
        attempts: 0,
        cacheHit: false,
        error: "circuit open",
      });
      throw new CircuitOpenError(retryAfterMs);
    }

    const maxRetries = placesConfig.maxRetries;
    let attempts = 0;
    let lastError: unknown;

    while (attempts <= maxRetries) {
      attempts += 1;
      try {
        const payload = await this.attempt<T>(url, init);
        this.recordSuccess();
        this.logger({
          endpoint,
          skuTier: tier,
          outcome: attempts > 1 ? "retried" : "ok",
          latencyMs: this.now() - started,
          attempts,
          httpStatus: 200,
          resultCount: countPlaces(payload),
          cacheHit: false,
        });
        return payload;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof GoogleApiError ? error.retryable : true;

        if (!retryable || attempts > maxRetries) break;

        // Exponential backoff with full jitter. Without the jitter, four
        // parallel tile workers that fail together retry together forever.
        const base = placesConfig.retryBaseDelayMs * 2 ** (attempts - 1);
        await this.sleep(Math.round(base * (0.5 + Math.random() * 0.5)));
      }
    }

    this.recordFailure();
    const status = lastError instanceof GoogleApiError ? lastError.status : undefined;
    this.logger({
      endpoint,
      skuTier: tier,
      outcome: "failed",
      latencyMs: this.now() - started,
      attempts,
      httpStatus: status,
      cacheHit: false,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
    throw lastError;
  }

  private async attempt<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), placesConfig.requestTimeoutMs);

    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });

      if (!response.ok) {
        const body = (await safeJson(response)) as GoogleErrorBody | null;
        const message = body?.error?.message ?? `HTTP ${response.status}`;
        throw new GoogleApiError(
          message,
          response.status,
          body?.error?.status,
          response.status === 429 || response.status >= 500,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= placesConfig.circuitFailureThreshold) {
      this.circuitOpenUntil = this.now() + placesConfig.circuitResetMs;
      this.consecutiveFailures = 0;
    }
  }
}

/* ----------------------------------------------------------------- helpers */

function isLocationRestrictionRejection(error: unknown): boolean {
  if (!(error instanceof GoogleApiError)) return false;
  if (error.status !== 400) return false;
  return /location\s*restriction/i.test(error.message) || error.googleStatus === "INVALID_ARGUMENT";
}

function countPlaces(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const places = (payload as GoogleSearchResponse).places;
  return Array.isArray(places) ? places.length : undefined;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * One line per call, JSON, so Vercel's log drain can aggregate cost and
 * latency without anyone parsing prose.
 */
function defaultLogger(log: CallLog): void {
  console.info(JSON.stringify({ tag: "places.call", ...log }));
}

/** Convenience for callers that just want a client with the ambient key. */
export function createGoogleClient(options: GoogleClientOptions = {}): GoogleClient {
  return new GoogleClient(options);
}

export { skuTierForFields };
