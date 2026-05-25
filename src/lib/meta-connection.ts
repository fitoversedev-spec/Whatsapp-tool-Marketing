// Live status fetcher for the Meta WhatsApp Cloud API connection.
// Used by the /connection page to show phone, WABA, templates, payment status.

import axios from "axios";

const API = process.env.META_GRAPH_API_VERSION || "v21.0";
const PHONE_ID = process.env.META_PHONE_NUMBER_ID || "";
const WABA_ID = process.env.META_WABA_ID || "";
const TOKEN = process.env.META_ACCESS_TOKEN || "";
const APP_SECRET = process.env.META_APP_SECRET || "";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || "";

function auth() {
  return { headers: { Authorization: `Bearer ${TOKEN}` } };
}

async function safeGet<T>(url: string): Promise<{ data?: T; error?: string }> {
  try {
    const r = await axios.get(url, auth());
    return { data: r.data as T };
  } catch (err: any) {
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
  const configured = !!(PHONE_ID && WABA_ID && TOKEN);

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
    errors.push("Meta credentials not set in .env — fill META_PHONE_NUMBER_ID, META_WABA_ID, META_ACCESS_TOKEN.");
    return status;
  }

  // ── Token introspection (uses app token; needs APP_SECRET) ─────────────
  if (APP_SECRET) {
    const appToken = `1460614352002830|${APP_SECRET}`;
    const tok = await safeGet<{ data: any }>(
      `https://graph.facebook.com/${API}/debug_token?input_token=${TOKEN}&access_token=${appToken}`
    );
    if (tok.data?.data) {
      status.tokenInfo = {
        valid: !!tok.data.data.is_valid,
        appId: tok.data.data.app_id,
        type: tok.data.data.type,
        expiresAt: tok.data.data.expires_at ?? null,
        scopes: tok.data.data.scopes ?? [],
      };
    }
  }

  // ── Phone number details ───────────────────────────────────────────────
  const phoneRes = await safeGet<any>(
    `https://graph.facebook.com/${API}/${PHONE_ID}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,name_status,code_verification_status,platform_type`
  );
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
  const wabaRes = await safeGet<any>(
    `https://graph.facebook.com/${API}/${WABA_ID}?fields=id,name,timezone_id,message_template_namespace`
  );
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
  const profileRes = await safeGet<any>(
    `https://graph.facebook.com/${API}/${PHONE_ID}/whatsapp_business_profile?fields=about,description,address,email,websites,profile_picture_url,vertical`
  );
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
  const tplRes = await safeGet<any>(
    `https://graph.facebook.com/${API}/${WABA_ID}/message_templates?limit=50&fields=id,name,language,status,category,components`
  );
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
