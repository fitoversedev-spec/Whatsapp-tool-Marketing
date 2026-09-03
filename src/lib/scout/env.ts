/**
 * Environment access. Every variable the app reads is named here once, so
 * `.env.example` and the handoff doc have a single source to track.
 *
 * Nothing in this file is imported by client components — the Google server
 * key and the Anthropic key must never reach the browser bundle.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },

  /** Session cookie signing/derivation secret. 32+ random bytes, base64. */
  get authSecret(): string {
    const value = process.env.AUTH_SECRET;
    if (!value || value.length < 32) {
      throw new Error(
        "AUTH_SECRET must be set to at least 32 characters. Generate one with: openssl rand -base64 48",
      );
    }
    return value;
  },

  get appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  },

  /**
   * Signs the 90-day report links a customer opens from WhatsApp.
   *
   * Separate from `AUTH_SECRET` on purpose, with a fallback to it. The two
   * credentials protect things with very different lifetimes: rotating the
   * session secret should sign everybody out, and it should *not* silently
   * break every report link a salesperson has sent in the last three months.
   * Setting `REPORT_LINK_SECRET` decouples them; leaving it unset keeps one
   * secret to manage and accepts that rotation kills live links.
   *
   * Same 32-character floor either way. A report is a customer's site
   * assessment and the signature is the only thing standing between it and
   * anyone who has ever seen the URL.
   */
  get reportLinkSecret(): string {
    const dedicated = process.env.REPORT_LINK_SECRET?.trim();
    if (dedicated && dedicated.length >= 32) return dedicated;
    if (dedicated) {
      throw new Error(
        "REPORT_LINK_SECRET is set but shorter than 32 characters. Generate one with: " +
          "openssl rand -base64 48 — or unset it to fall back to AUTH_SECRET.",
      );
    }
    return env.authSecret;
  },

  /**
   * Optional signup domain allowlist. Empty (the default, and the client's
   * choice as of 18 Aug 2026) means any domain may register. The switch exists
   * so it can be turned on later without a code change.
   */
  get signupAllowedDomains(): string[] {
    const raw = process.env.SIGNUP_ALLOWED_DOMAINS ?? "";
    return raw
      .split(",")
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
  },

  /* ----------------------------------------------------------- Google */

  /**
   * Places API (New) and Geocoding. **Server only** — deliberately without a
   * `NEXT_PUBLIC_` prefix so importing it into a client component is a build
   * error rather than a leaked key.
   *
   * Optional at boot on purpose. As of 18 Aug 2026 the client is still waiting
   * on Google Cloud billing approval, and Phases 2–8 must stay buildable in
   * the meantime. Missing means "no scan can run", not "the app cannot start";
   * `requireGoogleMapsServerKey()` is what turns absence into a loud failure,
   * and the scan API calls it before it writes anything.
   */
  get googleMapsServerKey(): string | undefined {
    const value = process.env.GOOGLE_MAPS_SERVER_KEY?.trim();
    // The placeholder that ships in .env.example is not a key.
    return !value || value === "PASTE_HERE" ? undefined : value;
  },

  get hasGoogleServerKey(): boolean {
    return env.googleMapsServerKey !== undefined;
  },

  /**
   * Fail at the edge of the request, before a scan row exists, rather than at
   * tile 6 of 8 with a half-written job.
   */
  requireGoogleMapsServerKey(): string {
    const key = env.googleMapsServerKey;
    if (!key) {
      throw new Error(
        "GOOGLE_MAPS_SERVER_KEY is not set. Scans cannot run without it. " +
          "Enable Places API (New) and Geocoding in the Google Cloud project, create a " +
          "server key with an API restriction (not an HTTP referrer restriction), and put it " +
          "in .env.local. It must never be given a NEXT_PUBLIC_ prefix.",
      );
    }
    return key;
  },

  /** Browser map rendering only. Referrer-restricted; never used server-side. */
  get googleMapsBrowserKey(): string | undefined {
    const value = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY?.trim();
    return !value || value === "PASTE_HERE" ? undefined : value;
  },

  get googleCloudProjectId(): string | undefined {
    const value = process.env.GOOGLE_CLOUD_PROJECT_ID?.trim();
    return !value || value === "PASTE_HERE" ? undefined : value;
  },

  /* ------------------------------------------------------ Vercel Blob */

  /**
   * `BLOB_READ_WRITE_TOKEN` — the store credential `@vercel/blob` reads.
   *
   * **Server only, and never a `NEXT_PUBLIC_` prefix.** It is a read *and*
   * write credential for the whole store: anyone holding it can read every
   * report ever generated, and overwrite them. Vercel sets it automatically on
   * a deployment with a Blob store attached; locally it comes from
   * `vercel env pull`.
   *
   * Optional at boot, deliberately, and for the same reason as the Google key
   * above: `reportStorage()` still returns the Postgres implementation, so an
   * absent token must not stop the app booting or the suite running. Absence
   * means "the Blob backend cannot be installed", not "the app is broken".
   * `requireBlobReadWriteToken()` is what turns absence into a loud failure,
   * and it is called at the point of use.
   */
  get blobReadWriteToken(): string | undefined {
    const value = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    // The placeholder that ships in .env.example is not a token.
    return !value || value === "PASTE_HERE" ? undefined : value;
  },

  get hasBlobReadWriteToken(): boolean {
    return env.blobReadWriteToken !== undefined;
  },

  /**
   * Fail before the upload rather than inside the SDK.
   *
   * `@vercel/blob` will happily read `process.env.BLOB_READ_WRITE_TOKEN`
   * itself and throw "No token found" — which says nothing about which store,
   * which environment, or what to do. The token is passed explicitly instead,
   * so the failure names the fix.
   */
  requireBlobReadWriteToken(): string {
    const token = env.blobReadWriteToken;
    if (!token) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is not set, so report PDFs cannot be stored. Attach a Vercel " +
          "Blob store to the project — the token is injected automatically on deployment — or " +
          "run `vercel env pull` for local development. It is a read/write credential for the " +
          "entire store and must never be given a NEXT_PUBLIC_ prefix.",
      );
    }
    return token;
  },

  /**
   * `REPORT_BLOB_PREFIX` — the folder report PDFs are written under.
   *
   * Configurable because the host application's Blob store is shared with
   * whatever else it already keeps there, and Stage A6 is namespacing Site
   * Scout's tables for the same reason. A leading or trailing slash is
   * tolerated rather than becoming an empty path segment.
   */
  get reportBlobPrefix(): string {
    const raw = process.env.REPORT_BLOB_PREFIX?.trim();
    const cleaned = (!raw || raw === "PASTE_HERE" ? "reports" : raw).replace(/^\/+|\/+$/g, "");
    return cleaned || "reports";
  },

  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },

  get isTest(): boolean {
    return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  },
} as const;
