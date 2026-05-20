import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/PageHeader";
import RecipientsTable from "./RecipientsTable";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export default async function BroadcastDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const broadcast = await prisma.broadcast.findUnique({
    where: { id: params.id },
    include: {
      template: { select: { name: true, language: true, body: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!broadcast) notFound();

  // Sales sees only own
  if (user.role !== "admin" && broadcast.createdByUserId !== user.id) {
    redirect("/broadcasts");
  }

  const recipients = await prisma.broadcastRecipient.findMany({
    where: { broadcastId: broadcast.id },
    orderBy: [{ status: "asc" }, { phoneE164: "asc" }],
    take: 500,
  });

  return (
    <>
      <PageHeader
        title={broadcast.name}
        description={`Template: ${broadcast.template.name} (${broadcast.template.language}) · by ${broadcast.createdBy.name}`}
        action={
          <Link
            href="/broadcasts"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            All broadcasts
          </Link>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Status + counters */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <span
              className={`inline-block px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wide ${
                STATUS_COLORS[broadcast.status] ?? "bg-slate-100"
              }`}
            >
              {broadcast.status}
            </span>
            <div className="text-xs text-slate-500 text-right">
              {broadcast.launchedAt && (
                <div>Launched: {new Date(broadcast.launchedAt).toLocaleString()}</div>
              )}
              {broadcast.completedAt && (
                <div>Completed: {new Date(broadcast.completedAt).toLocaleString()}</div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Stat label="Total" value={broadcast.total} />
            <Stat label="Sent" value={broadcast.sent} color="text-blue-700" />
            <Stat label="Delivered" value={broadcast.delivered} color="text-emerald-700" />
            <Stat label="Read" value={broadcast.read} color="text-purple-700" />
            <Stat label="Failed" value={broadcast.failed} color={broadcast.failed > 0 ? "text-red-600" : "text-slate-700"} />
          </div>
          {broadcast.total > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="text-xs text-slate-500 mb-1.5">Progress</div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-wa-green transition-all"
                  style={{ width: `${Math.min(100, (broadcast.sent / broadcast.total) * 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>{broadcast.sent} of {broadcast.total} sent</span>
                <span>{Math.round((broadcast.sent / broadcast.total) * 100)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Template preview */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="text-sm font-semibold text-slate-900 mb-2">Template body</div>
          <div className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap font-mono text-xs break-words">
            {broadcast.template.body}
          </div>
        </div>

        {/* Recipients */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-900">Recipients</div>
            <p className="text-xs text-slate-500 mt-0.5">
              {recipients.length === 0
                ? "No recipients yet (broadcast hasn't enqueued any)."
                : `${recipients.length} recipient${recipients.length === 1 ? "" : "s"} · filter and search below`}
            </p>
          </div>
          <RecipientsTable
            recipients={recipients.map((r) => ({
              id: r.id,
              phoneE164: r.phoneE164,
              name: r.name,
              status: r.status,
              errorCode: r.errorCode,
              errorMessage: r.errorMessage,
              sentAt: r.sentAt?.toISOString() ?? null,
              deliveredAt: r.deliveredAt?.toISOString() ?? null,
              readAt: r.readAt?.toISOString() ?? null,
            }))}
          />
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className={`text-2xl font-bold ${color ?? "text-slate-900"}`}>{value}</div>
      <div className="text-xs text-slate-500 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}
