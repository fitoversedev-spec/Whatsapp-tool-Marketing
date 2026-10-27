import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import type { ApprovalExecutor } from "../executors";
import * as read from "./read";
import * as leads from "./leads";
import * as messaging from "./messaging";
import * as quotes from "./quotes";
import * as deals from "./deals";
import * as documents from "./documents";
import * as approvals from "./approvals";
import * as website from "./website";

type Area = { TOOLS: Record<string, ToolDefinition>; ROUTES: AgentRouteSpec[]; EXECUTORS?: Record<string, ApprovalExecutor> };
const AREAS: Area[] = [read, leads, messaging, quotes, deals, documents, approvals, website];

export const AREA_TOOLS: Record<string, ToolDefinition>[] = AREAS.map((a) => a.TOOLS);
export const AREA_ROUTES: AgentRouteSpec[] = AREAS.flatMap((a) => a.ROUTES);
/** Approved-request runners from every area, keyed by tool name. */
export const AREA_EXECUTORS: Record<string, ApprovalExecutor> = Object.assign({}, ...AREAS.map((a) => a.EXECUTORS ?? {}));
