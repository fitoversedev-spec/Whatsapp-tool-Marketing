import { withAgent } from "@/lib/agent/withAgent";
import { getEligibilityHandler } from "@/lib/agent/messaging/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = withAgent("get_send_eligibility", getEligibilityHandler, { mutating: false });
