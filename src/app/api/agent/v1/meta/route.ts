import { getCrmMeta } from "@/lib/agent/read/meta";
import { withAgent } from "@/lib/agent/withAgent";

// get_crm_meta: lead stages, lead sources, activity types, customer profiles and supported sports.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const GET = withAgent("get_crm_meta", async () => ({ body: await getCrmMeta() }), { mutating: false });
