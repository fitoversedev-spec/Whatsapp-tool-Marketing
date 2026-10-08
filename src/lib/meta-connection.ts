// Live status fetcher for the Meta WhatsApp Cloud API connection.
// Used by the /connection page to show phone, WABA, templates, payment status.

import axios from "axios";
import { getMetaAccessToken } from "./token-manager";

const API = process.env.META_GRAPH_API_VERSION || "v21.0";
const PHONE_ID = process.env.META_PHONE_NUMBER_ID || "";
const WABA_ID = process.env.META_WABA_ID || "";
const APP_SECRET = process.env.META_APP_SECRET || "";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || "";

async function auth() {
  const token = await getMetaAccessToken();
  return { headers: { Authorization: `Bearer ${token}` } };
}

// 10 s per call: the checks below run in parallel, so the whole page is bounded
// by the slowest one rather than the sum of five.
const CALL_TIMEOUT_MS = 10_000;

async function safeGet<T>(
  url: string,
  authConfig?: { headers: { Authorization: string } },
): Promise<{ data?: T; error?: string }> {
  try {
    const r = await axios.get(url, { ...(authConfig ?? (await auth())), timeout: CALL_TIMEOUT_MS });
    return { data: r.data as T };
  } catch (err: any) {
    if (!err.response && (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT")) {
      return { error: "Meta didn't respond within 10 s" };
    }
    const m = err.response?.data?.error?.message ?? err.message;
    return { error: m };
  }
}

export type ConnectionStatus = {
  configured: boolean;
  phone?: {
    id: string;
    displayNumber: string;
    verifiedName: string;
    qualityRating: string;
    messagingLimitTier: string;
    nameStatus?: string;
    codeVerificationStatus?: string;
    platformType?: string;
  };
  waba?: {
    id: string;
    name: string;
    timezoneId?: string;
    namespace?: string;
    hasPaymentMethod: boolean; // false because non-BSP apps can't detect via API
  };
  profile?: {
    about?: string;
    description?: string;
    websites?: string[];
    email?: string;
    address?: string;
    profilePictureUrl?: string;
    vertical?: string;
  };
  templates?: {
    metaTemplateId: string;
    name: string;
    language: string;
    status: string;
    category: string;
    body?: string;
  }[];
  webhook: {
    verifyTokenSet: boolean;
    appSecretSet: boolean;
    apiVersion: string;
    callbackPath: string;
  };
  tokenInfo?: {
    valid: boolean;
    appId?: string;
    type?: string;
    expiresAt?: number | null;
    scopes?: string[];
  };
  errors: string[];
};

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const errors: string[] = [];
  const token = await getMetaAccessToken();
  const configured = !!(PHONE_ID && WABA_ID && token);

  const status: ConnectionStatus = {
    configured,
    webhook: {
      verifyTokenSet: !!VERIFY_TOKEN,
      appSecretSet: !!APP_SECRET,
      apiVersion: API,
      callbackPath: "/api/webhooks/whatsapp",
    },
    errors,
  };

  if (!configured) {
    errors.push("Meta credentials not set — fill META_PHONE_NUMBER_ID, META_WABA_ID, and seed an access token via the Connection page.");
    return status;
  }

  // Fire all five Meta calls at once, then fill the status in the same order
  // as before (so the errors list keeps its order).
  const authConfig = await auth();
  const appToken = `1460614352002830|${APP_SECRET}`;
  const [tok, phoneRes, wabaRes, profileRes, tplRes] = await Promise.all([
    // Token introspection (uses app token; needs APP_SECRET)
    APP_SECRET
      ? safeGet<{ data: any }>(
          `https://graph.facebook.com/${API}/debug_token?input_token=${token}&access_token=${appToken}`,
          authConfig,
        )
      : Promise.resolve(null),
    safeGet<any>(
      `https://graph.facebook.com/${API}/${PHONE_ID}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,name_status,code_verification_status,platform_type`,
      authConfig,
    ),
    safeGet<any>(
      `https://graph.facebook.com/${API}/${WABA_ID}?fields=id,name,timezone_id,message_template_namespace`,
      authConfig,
    ),
    safeGet<any>(
      `https://graph.facebook.com/${API}/${PHONE_ID}/whatsapp_business_profile?fields=about,description,address,email,websites,profile_picture_url,vertical`,
      authConfig,
    ),
    safeGet<any>(
      `https://graph.facebook.com/${API}/${WABA_ID}/message_templates?limit=50&fields=id,name,language,status,category,components`,
      authConfig,
    ),
  ]);

  // ── Token introspection ────────────────────────────────────────────────
  if (tok?.data?.data) {
    status.tokenInfo = {
      valid: !!tok.data.data.is_valid,
      appId: tok.data.data.app_id,
      type: tok.data.data.type,
      expiresAt: tok.data.data.expires_at ?? null,
      scopes: tok.data.data.scopes ?? [],
    };
  }

  // ── Phone number details ───────────────────────────────────────────────
  if (phoneRes.data) {
    const p = phoneRes.data;
    status.phone = {
      id: p.id,
      displayNumber: p.display_phone_number,
      verifiedName: p.verified_name,
      qualityRating: p.quality_rating,
      messagingLimitTier: p.messaging_limit_tier,
      nameStatus: p.name_status,
      codeVerificationStatus: p.code_verification_status,
      platformType: p.platform_type,
    };
  } else if (phoneRes.error) {
    errors.push(`Phone fetch failed: ${phoneRes.error}`);
  }

  // ── WABA details ───────────────────────────────────────────────────────
  // NOTE: `primary_funding_id`, `currency`, `account_review_status`, etc. require
  // Business Solution Provider permission — restricted by Meta. We fall back to
  // the always-readable fields here. Payment status is shown as "check dashboard"
  // since non-BSP apps can't query it via API.
  if (wabaRes.data) {
    const w = wabaRes.data;
    status.waba = {
      id: w.id,
      name: w.name,
      timezoneId: w.timezone_id,
      namespace: w.message_template_namespace,
      hasPaymentMethod: false, // unknown via API for non-BSP apps
    };
  } else if (wabaRes.error) {
    // Even basic fields may fail on some setups — still record the WABA ID we know
    status.waba = {
      id: WABA_ID,
      name: "(WABA details restricted)",
      hasPaymentMethod: false,
    };
    errors.push(`WABA details restricted: ${wabaRes.error}`);
  }

  // ── Business profile (about, websites, etc.) ───────────────────────────
  if (profileRes.data?.data?.[0]) {
    const p = profileRes.data.data[0];
    status.profile = {
      about: p.about,
      description: p.description,
      websites: p.websites ?? [],
      email: p.email,
      address: p.address,
      profilePictureUrl: p.profile_picture_url,
      vertical: p.vertical,
    };
  }

  // ── Templates ──────────────────────────────────────────────────────────
  if (tplRes.data?.data) {
    status.templates = tplRes.data.data.map((t: any) => {
      const body = (t.components ?? []).find((c: any) => c.type === "BODY")?.text;
      return {
        metaTemplateId: t.id,
        name: t.name,
        language: t.language,
        status: t.status,
        category: t.category,
        body,
      };
    });
  } else if (tplRes.error) {
    errors.push(`Templates fetch failed: ${tplRes.error}`);
  }

  return status;
}
