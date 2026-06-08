// Auto-refreshing Meta access token manager.
//
// Flow:
// 1. Admin pastes a short-lived (24h) user token in the UI → exchanged for a
//    60-day long-lived token, persisted to the `settings` table.
// 2. Every Meta API call goes through getMetaAccessToken(), which reads from
//    DB (with a 30s in-memory cache) and lazily refreshes when the token has
//    less than REFRESH_BUFFER_DAYS remaining.
// 3. Calendar-free operation: as long as the tool runs at least once every
//    55 days, the token refreshes itself and the cycle continues indefinitely.
//
// Fallback: if no token is in the DB yet (first run), reads `META_ACCESS_TOKEN`
// from env so the existing .env-based setup keeps working until first seed.

import axios from "axios";
import { prisma } from "./prisma";

// App ID drives the fb_exchange_token call. Defaults to the original "Fito
// Marketing tool" app id for backwards compatibility; override via META_APP_ID
// env when migrating to a new app (e.g. "Fitoverse Messaging" = 974466495199004
// in Fitoverse business — same business as the WABA).
const APP_ID = process.env.META_APP_ID || "1460614352002830";
const APP_SECRET = process.env.META_APP_SECRET || "";
const API = process.env.META_GRAPH_API_VERSION || "v21.0";

const KEY_TOKEN = "meta_access_token";
const KEY_EXPIRY = "meta_token_expires_at"; // seconds since epoch
const KEY_REFRESHED_AT = "meta_token_refreshed_at"; // ISO string

const REFRESH_BUFFER_DAYS = 5;
const REFRESH_BUFFER_SECONDS = REFRESH_BUFFER_DAYS * 24 * 60 * 60;

// In-memory cache to avoid DB lookup on every Meta API call.
// Bust on token write; otherwise 30s is fine — even one stale call per
// 30s is harmless because lazy refresh still works on the next call.
let memCache: { token: string; expiresAt: number } | null = null;
let memCachedAt = 0;
const MEM_CACHE_MS = 30_000;

export type TokenStatus = {
  hasToken: boolean;
  source: "db" | "env" | "none";
  expiresAt: number | null; // seconds since epoch
  expiresAtIso: string | null;
  daysUntilExpiry: number | null;
  refreshedAt: string | null;
};

export async function getMetaAccessToken(): Promise<string> {
  if (memCache && Date.now() - memCachedAt < MEM_CACHE_MS) {
    return memCache.token;
  }

  const [tokenRow, expiryRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: KEY_TOKEN } }),
    prisma.setting.findUnique({ where: { key: KEY_EXPIRY } }),
  ]);

  if (!tokenRow?.value) {
    // Bootstrap: fall back to env until first seed
    return process.env.META_ACCESS_TOKEN || "";
  }

  const expiresAt = expiryRow ? parseInt(expiryRow.value, 10) : 0;
  const now = Math.floor(Date.now() / 1000);

  // Comfortably valid → cache and return
  if (expiresAt > now + REFRESH_BUFFER_SECONDS) {
    memCache = { token: tokenRow.value, expiresAt };
    memCachedAt = Date.now();
    return tokenRow.value;
  }

  // Close to expiry → refresh. If refresh fails, return existing token (it
  // might still have life left) rather than blocking the caller.
  try {
    const refreshed = await exchangeForLongToken(tokenRow.value);
    return refreshed.token;
  } catch (err) {
    console.error("[token-manager] auto-refresh failed:", err);
    return tokenRow.value;
  }
}

export async function exchangeForLongToken(
  inputToken: string
): Promise<{ token: string; expiresAt: number }> {
  if (!APP_SECRET) throw new Error("META_APP_SECRET is required to exchange tokens");
  if (!inputToken) throw new Error("inputToken is required");

  const res = await axios.get(`https://graph.facebook.com/${API}/oauth/access_token`, {
    params: {
      grant_type: "fb_exchange_token",
      client_id: APP_ID,
      client_secret: APP_SECRET,
      fb_exchange_token: inputToken,
    },
  });

  const newToken: string = res.data?.access_token || "";
  if (!newToken) throw new Error(`No access_token in exchange response: ${JSON.stringify(res.data)}`);

  // Meta returns expires_in seconds. Long-lived tokens are typically ~60 days.
  // If Meta omits expires_in (rare), default to 60 days.
  const expiresIn: number = res.data?.expires_in || 60 * 24 * 60 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const refreshedAt = new Date().toISOString();

  await Promise.all([
    prisma.setting.upsert({
      where: { key: KEY_TOKEN },
      update: { value: newToken },
      create: { key: KEY_TOKEN, value: newToken },
    }),
    prisma.setting.upsert({
      where: { key: KEY_EXPIRY },
      update: { value: expiresAt.toString() },
      create: { key: KEY_EXPIRY, value: expiresAt.toString() },
    }),
    prisma.setting.upsert({
      where: { key: KEY_REFRESHED_AT },
      update: { value: refreshedAt },
      create: { key: KEY_REFRESHED_AT, value: refreshedAt },
    }),
  ]);

  memCache = { token: newToken, expiresAt };
  memCachedAt = Date.now();

  return { token: newToken, expiresAt };
}

export async function getTokenStatus(): Promise<TokenStatus> {
  const [tokenRow, expiryRow, refreshedAtRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: KEY_TOKEN } }),
    prisma.setting.findUnique({ where: { key: KEY_EXPIRY } }),
    prisma.setting.findUnique({ where: { key: KEY_REFRESHED_AT } }),
  ]);

  if (tokenRow?.value) {
    const expiresAt = expiryRow ? parseInt(expiryRow.value, 10) : null;
    const now = Math.floor(Date.now() / 1000);
    const daysUntilExpiry = expiresAt ? Math.floor((expiresAt - now) / (24 * 60 * 60)) : null;
    return {
      hasToken: true,
      source: "db",
      expiresAt,
      expiresAtIso: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
      daysUntilExpiry,
      refreshedAt: refreshedAtRow?.value ?? null,
    };
  }

  const envToken = process.env.META_ACCESS_TOKEN;
  if (envToken) {
    return {
      hasToken: true,
      source: "env",
      expiresAt: null,
      expiresAtIso: null,
      daysUntilExpiry: null,
      refreshedAt: null,
    };
  }

  return {
    hasToken: false,
    source: "none",
    expiresAt: null,
    expiresAtIso: null,
    daysUntilExpiry: null,
    refreshedAt: null,
  };
}
