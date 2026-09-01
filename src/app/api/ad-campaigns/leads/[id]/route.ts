// PATCH one captured Meta lead's management fields (the detail-page sidebar):
// stage, assigned-to rep, follow-up reminder, and the applied label set. Open to
// all approved reps — same auth stance as the sibling move-to-crm route (ad
// leads aren't rep-scoped, so any rep can work a lead). Notes have their own
// sub-route (./notes); labels are created via /api/ad-campaigns/labels.
//
// [id] is the MetaLead.id (not the raw Meta leadgen id). Every field is
// optional so the client can PATCH just what changed.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LEAD_STAGES } from "@/lib/meta-ads/lead-fields";
import { getMetaLeadDetail } from "@/lib/meta-ads/queries";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const detail = await getMetaLeadDetail(params.id);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}

const patchSchema = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  // datetime-local sends "YYYY-MM-DDTHH:mm" (no zone/seconds), so accept any
  // parseable string; null clears the reminder ("No reminder").
  reminderAt: z.string().min(1).nullable().optional(),
  // Full replacement set of applied label ids (order-insensitive).
  labelIds: z.array(z.string().uuid()).optional(),
  // Sales follow-up JSON (sport, dimension, location, jobTitle, timeline, b2bB2c, custom[]).
  salesData: z.string().max(10_000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { stage, assignedToUserId, reminderAt, labelIds, salesData } = parsed.data;

  const lead = await prisma.metaLead.findUnique({
    where: { id: params.id },
    // fullName/phone label the reminder; current reminderAt/assignedToUserId let
    // us sync ownership on a pure reassignment (reminder field absent from PATCH).
    select: { id: true, fullName: true, phone: true, reminderAt: true, assignedToUserId: true },
  });
  if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Validate the assigned rep still exists (avoids an FK violation on a stale id).
  if (assignedToUserId) {
    const rep = await prisma.user.findUnique({
      where: { id: assignedToUserId },
      select: { id: true, deletedAt: true },
    });
    if (!rep || rep.deletedAt) return NextResponse.json({ error: "invalid_assignee" }, { status: 400 });
  }

  // Parse the reminder (when provided and non-null) into a Date.
  let reminderDate: Date | null | undefined;
  if (reminderAt !== undefined) {
    if (reminderAt === null) {
      reminderDate = null;
    } else {
      const d = new Date(reminderAt);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "invalid_reminder" }, { status: 400 });
      reminderDate = d;
    }
  }

  // Validate the label set exists before touching the join (clean 400 vs FK 500).
  if (labelIds && labelIds.length > 0) {
    const found = await prisma.metaLeadLabel.findMany({
      where: { id: { in: labelIds } },
      select: { id: true },
    });
    if (found.length !== new Set(labelIds).size) {
      return NextResponse.json({ error: "invalid_label" }, { status: 400 });
    }
  }

  const scalarData: {
    stage?: string;
    assignedToUserId?: string | null;
    reminderAt?: Date | null;
    salesData?: string | null;
  } = {};
  if (stage !== undefined) scalarData.stage = stage;
  if (assignedToUserId !== undefined) scalarData.assignedToUserId = assignedToUserId;
  if (reminderDate !== undefined) scalarData.reminderAt = reminderDate;
  if (salesData !== undefined) scalarData.salesData = salesData;

  await prisma.$transaction(async (tx) => {
    if (Object.keys(scalarData).length > 0) {
      await (tx.metaLead as any).update({ where: { id: params.id }, data: scalarData });
    }
    if (labelIds !== undefined) {
      // Replace the applied set: drop any no longer selected, add the new ones.
      await tx.metaLeadToLabel.deleteMany({
        where: { metaLeadId: params.id, labelId: { notIn: labelIds.length ? labelIds : ["__none__"] } },
      });
      if (labelIds.length > 0) {
        await tx.metaLeadToLabel.createMany({
          data: labelIds.map((labelId) => ({ metaLeadId: params.id, labelId })),
          skipDuplicates: true,
        });
      }
    }

    // When reminderAt is set via the sidebar, create a NEW Reminder row each
    // time (unlimited reminders per lead). When reminderAt is cleared (null),
    // we only clear the scalar — existing Reminder rows are managed individually
    // via DELETE /api/reminders/:id. When the assignee changes, reassign all
    // open reminders for this lead to the new rep.
    if (reminderDate !== undefined || assignedToUserId !== undefined) {
      const effectiveAssignee =
        assignedToUserId !== undefined ? assignedToUserId : lead.assignedToUserId;
      const ownerUserId = effectiveAssignee ?? user.id;

      if (reminderDate !== undefined && reminderDate) {
        const leadName = lead.fullName?.trim() || lead.phone || "lead";
        await tx.reminder.create({
          data: {
            ownerUserId,
            metaLeadId: params.id,
            dueAt: reminderDate,
            message: `Follow up with ${leadName} (Meta ad lead)`,
            channels: ["in_app"],
            status: "PENDING",
          },
        });
      }

      if (assignedToUserId !== undefined) {
        await tx.reminder.updateMany({
          where: { metaLeadId: params.id, completedAt: null },
          data: { ownerUserId },
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
}
