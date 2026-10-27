// Server-only access to Google Analytics 4 (Data API) and Search Console. One
// service account (GOOGLE_ANALYTICS_CREDENTIALS, base64 of its JSON key) reads
// both; it must be added as a viewer on the GA4 property and the Search Console
// site. The key never leaves this file: it is not logged and not returned.
//
// googleapis is huge, so only the two API files are loaded (not the package
// root), and only when a report is actually built.
import type { analyticsdata_v1beta } from "googleapis/build/src/apis/analyticsdata/v1beta";
import type { searchconsole_v1 } from "googleapis/build/src/apis/searchconsole/v1";

export type GaRunReportRequest = analyticsdata_v1beta.Schema$RunReportRequest;
export type GaRunReportResponse = analyticsdata_v1beta.Schema$RunReportResponse;
export type GaRealtimeRequest = analyticsdata_v1beta.Schema$RunRealtimeReportRequest;
export type GaRealtimeResponse = analyticsdata_v1beta.Schema$RunRealtimeReportResponse;
export type GscQueryRequest = searchconsole_v1.Schema$SearchAnalyticsQueryRequest;
export type GscQueryResponse = searchconsole_v1.Schema$SearchAnalyticsQueryResponse;

export type GaApi = {
  runReport(body: GaRunReportRequest): Promise<GaRunReportResponse>;
  batchRunReports(requests: GaRunReportRequest[]): Promise<GaRunReportResponse[]>;
  runRealtimeReport(body: GaRealtimeRequest): Promise<GaRealtimeResponse>;
};
export type GscApi = { query(body: GscQueryRequest): Promise<GscQueryResponse> };

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
];
// Each call to Google gives up after this; the route as a whole stays well under 25 s.
const CALL_TIMEOUT_MS = 20_000;

const CREDENTIALS = "GOOGLE_ANALYTICS_CREDENTIALS";
const GA_SETTINGS = ["GA4_PROPERTY_ID", CREDENTIALS];
const GSC_SETTINGS = ["GSC_SITE_URL", CREDENTIALS];

/** The settings this part still needs (empty = connected). Names only, never values. */
export function missingSettings(part: "ga" | "gsc"): string[] {
  return (part === "ga" ? GA_SETTINGS : GSC_SETTINGS).filter((name) => !process.env[name]?.trim());
}

/** Set but unusable (not base64 of a service-account key, a property id that isn't a number). */
export class AnalyticsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsConfigError";
  }
}

function readCredentials(): { email: string; key: string } {
  let json: { client_email?: unknown; private_key?: unknown };
  try {
    json = JSON.parse(Buffer.from(process.env[CREDENTIALS] ?? "", "base64").toString("utf-8"));
  } catch {
    throw new AnalyticsConfigError(`${CREDENTIALS} is not base64 of a service-account JSON key`);
  }
  if (typeof json?.client_email !== "string" || typeof json.private_key !== "string") {
    throw new AnalyticsConfigError(`${CREDENTIALS} has no client_email / private_key`);
  }
  // A key pasted through an env UI can arrive with literal \n instead of line breaks.
  return { email: json.client_email, key: json.private_key.replace(/\\n/g, "\n") };
}

// One signed-in client per part, so the token is fetched once and not per report.
const clients = new Map<string, { settings: string; value: unknown }>();
async function memo<T>(part: "ga" | "gsc", build: () => Promise<T>): Promise<T> {
  const settings = [process.env[CREDENTIALS], process.env.GA4_PROPERTY_ID, process.env.GSC_SITE_URL].join("|");
  const hit = clients.get(part);
  if (hit && hit.settings === settings) return hit.value as T;
  const value = await build();
  clients.set(part, { settings, value });
  return value;
}

export function getGaApi(): Promise<GaApi> {
  return memo("ga", async () => {
    const raw = (process.env.GA4_PROPERTY_ID ?? "").trim();
    const id = /^(?:properties\/)?(\d{1,20})$/.exec(raw)?.[1];
    if (!id) throw new AnalyticsConfigError("GA4_PROPERTY_ID is not a number");
    const property = `properties/${id}`;

    const { analyticsdata_v1beta, AuthPlus } = await import("googleapis/build/src/apis/analyticsdata");
    const { email, key } = readCredentials();
    const auth = new (new AuthPlus().JWT)({ email, key, scopes: SCOPES });
    const properties = new analyticsdata_v1beta.Analyticsdata({ auth }).properties;
    const options = { timeout: CALL_TIMEOUT_MS };

    return {
      runReport: async (requestBody) => (await properties.runReport({ property, requestBody }, options)).data,
      batchRunReports: async (requests) =>
        (await properties.batchRunReports({ property, requestBody: { requests } }, options)).data.reports ?? [],
      runRealtimeReport: async (requestBody) =>
        (await properties.runRealtimeReport({ property, requestBody }, options)).data,
    };
  });
}

export function getGscApi(): Promise<GscApi> {
  return memo("gsc", async () => {
    const siteUrl = (process.env.GSC_SITE_URL ?? "").trim();
    if (!siteUrl) throw new AnalyticsConfigError("GSC_SITE_URL is empty");

    const { searchconsole_v1, AuthPlus } = await import("googleapis/build/src/apis/searchconsole");
    const { email, key } = readCredentials();
    const auth = new (new AuthPlus().JWT)({ email, key, scopes: SCOPES });
    const searchanalytics = new searchconsole_v1.Searchconsole({ auth }).searchanalytics;

    return {
      query: async (requestBody) =>
        (await searchanalytics.query({ siteUrl, requestBody }, { timeout: CALL_TIMEOUT_MS })).data,
    };
  });
}

/**
 * A short line for the server log about a failed Google call: the HTTP status and
 * message only. Never the error object itself, whose request config carries the
 * access token.
 */
export function describeGoogleError(err: unknown): string {
  const e = err as { code?: unknown; status?: unknown; message?: unknown; response?: { status?: unknown } } | null;
  const status = e?.response?.status ?? e?.status ?? e?.code;
  const message = typeof e?.message === "string" ? e.message : String(err);
  return `${status != null ? `status ${String(status)}: ` : ""}${message.replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[key]").slice(0, 300)}`;
}

/** The HTTP status Google answered with, if any. */
export function googleStatus(err: unknown): number | null {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  const n = Number(e?.response?.status ?? e?.status ?? e?.code);
  return Number.isInteger(n) && n >= 100 && n < 600 ? n : null;
}
