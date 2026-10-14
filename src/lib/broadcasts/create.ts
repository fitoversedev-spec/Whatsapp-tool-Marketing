import { prisma } from "@/lib/prisma";
import { parseSheetId } from "@/lib/sheets";
import { scheduleWindowError } from "./schedule";

// Creating a broadcast record. Shared by POST /api/broadcasts and the AI agent's
// draft_broadcast so both apply the same template, source, group and schedule
// rules. Callers validate the request's shape; this applies the business rules.

export type FilterRule = {
  column?: string;
  field?: string;
  condition: "equals" | "contains" | "starts_with" | "not_empty";
  value?: string;
};

export type CreateBroadcastInput = {
  name: string;
  sourceType: "file" | "sheet" | "contacts";
  sheetUrl?: string;
  sheetRange?: string;
  fileData?: string;
  templateId: string;
  phoneColumn?: string;
  countryCodeColumn?: string;
  nameColumn?: string;
  variableMapping: Record<string, string>;
  filterRules?: FilterRule[];
  selectedContactIds?: string[];
  groupId?: string;
  scheduledAt?: string;
  createdByUserId: string;
  /** Extra keys kept in the variableMapping JSON blob (the sender ignores keys it does not know). */
  extraMapping?: Record<string, unknown>;
};

export type CreateBroadcastResult =
  | { ok: true; broadcast: { id: string; status: string; scheduledAt: string | null } }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): CreateBroadcastResult => ({ ok: false, status, error });

export async function createBroadcastRecord(input: CreateBroadcastInput): Promise<CreateBroadcastResult> {
  const template = await prisma.template.findUnique({ where: { id: input.templateId } });
  if (!template || template.status !== "approved" || template.deletedAt) {
    return fail(422, "Template must be approved and active");
  }

  const { sourceType } = input;

  // Validate the source has what it needs
  if (sourceType === "file" && !input.fileData) return fail(400, "File data is required");
  if (sourceType === "sheet" && (!input.sheetUrl || !input.sheetRange)) {
    return fail(400, "Sheet URL and range are required");
  }

  // Group recipients: the group must still exist and have someone in it.
  const groupId = sourceType === "contacts" ? input.groupId ?? null : null;
  let groupName: string | null = null;
  if (groupId) {
    const group = await prisma.broadcastGroup.findUnique({
      where: { id: groupId },
      select: { name: true, _count: { select: { members: true } } },
    });
    if (!group) return fail(404, "This group no longer exists");
    if (group._count.members === 0) return fail(422, "This group has no members yet");
    groupName = group.name;
  }

  const sheetId = input.sheetUrl ? parseSheetId(input.sheetUrl) : null;

  let scheduledAt: Date | null = null;
  if (input.scheduledAt) {
    const candidate = new Date(input.scheduledAt);
    const problem = scheduleWindowError(candidate);
    if (problem) return fail(422, problem);
    scheduledAt = candidate;
  }

  const broadcast = await prisma.broadcast.create({
    data: {
      name: input.name,
      sourceType,
      sheetId,
      sheetRange: input.sheetRange ?? null,
      fileData: input.fileData ?? null,
      templateId: input.templateId,
      variableMapping: JSON.stringify({
        phoneColumn: input.phoneColumn ?? null,
        countryCodeColumn: input.countryCodeColumn ?? null,
        nameColumn: input.nameColumn ?? null,
        variables: input.variableMapping,
        filterRules: groupId ? [] : (input.filterRules ?? []).filter((r) => (r.column || r.field || "").trim()),
        selectedContactIds: groupId ? null : input.selectedContactIds ?? null,
        groupId,
        groupName,
        ...(input.extraMapping ?? {}),
      }),
      status: scheduledAt ? "scheduled" : "draft",
      scheduledAt,
      createdByUserId: input.createdByUserId,
    },
  });

  return {
    ok: true,
    broadcast: { id: broadcast.id, status: broadcast.status, scheduledAt: broadcast.scheduledAt?.toISOString() ?? null },
  };
}
