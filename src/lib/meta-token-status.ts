import "server-only";

// Does the Meta (WhatsApp) access token still work? Drives the admin-only
// "token expired" warning in the sidebar.
//
// This used to be a live graph.facebook.com call awaited inside the dashboard
// layout on every admin page load (up to 2 s — longer while the token manager
// refreshed a near-expiry token), so the whole page waited on Facebook. Now the
// layout and the badge poll read the last known answer instantly; when it is
// older than 10 minutes a re-check runs after the response and the next
// render/poll shows the result.

import axios from "axios";
import { getMetaAccessToken } from "@/lib/token-manager";
import { after } from "@/lib/scout/after";

const TTL_MS = 10 * 60 * 1000;

let last: { valid: boolean; at: number } | null = null;
let checking = false;

async function checkTokenValid(): Promise<boolean> {
  const token = await getMetaAccessToken();
  const phoneId = process.env.META_PHONE_NUMBER_ID;
  if (!token || !phoneId) return true; // not configured, don't show expired warning
  try {
    // Token-manager auto-refreshes within 5d of expiry, so this check covers
    // the (rare) case where refresh failed or the token was revoked.
    await axios.get(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || "v21.0"}/${phoneId}?fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 2000,
    });
    return true;
  } catch (err: any) {
    const code = err?.response?.data?.error?.code;
    // Code 190 = OAuthException (expired/invalid token)
    if (code === 190) return false;
    return true; // network error or other — don't show false alarm
  }
}

/** Last known token validity — true until a check says otherwise. Never waits on Facebook. */
export function metaTokenValid(): boolean {
  if ((!last || Date.now() - last.at > TTL_MS) && !checking) {
    checking = true;
    after(
      checkTokenValid()
        .catch(() => true)
        .then((valid) => {
          last = { valid, at: Date.now() };
        })
        .finally(() => {
          checking = false;
        })
    );
  }
  return last?.valid ?? true;
}
