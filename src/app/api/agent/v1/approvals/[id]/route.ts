import { getApprovalForIdentity } from "@/lib/agent/approvals";
import { AgentHttpError } from "@/lib/agent/errors";
import { withAgent } from "@/lib/agent/withAgent";

// get_approval_status: how one of this AI's own approval requests is going.
// Read-only. A request made by a different identity is reported as not found.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// withAgent gives a handler 25 s; leave room for the audit write after it.
export const maxDuration = 30;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const GET = withAgent(
  "get_approval_status",
  async ({ ctx, params }) => {
    if (!params.id || !ID_RE.test(params.id)) throw new AgentHttpError("not_found", "Approval request not found.");
    const view = await getApprovalForIdentity(ctx.identityId, params.id);
    if (!view) throw new AgentHttpError("not_found", "Approval request not found.");
    return { body: view, recordIds: [view.id] };
  },
  { mutating: false },
);
