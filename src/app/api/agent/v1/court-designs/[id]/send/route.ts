import { sendDesign } from "@/lib/agent/designs/send";
import { sendDesignBodySchema } from "@/lib/agent/schemas/documents";
import { withAgent } from "@/lib/agent/withAgent";

// send_design: the phone comes from the design's own conversation or contact, never from the request.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

export const POST = withAgent("send_design", sendDesign, { mutating: true, inputSchema: sendDesignBodySchema });
