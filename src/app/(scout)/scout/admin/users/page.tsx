import type { Metadata } from "next";
import { Badge } from "@/components/scout/ui";
import { ScreenScaffold, SectionLabel } from "@/components/scout/patterns";
import { prisma } from "@/lib/prisma";
import { PendingRow } from "./PendingRow";

export const metadata: Metadata = { title: "Users — Site Scout admin" };
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export default async function AdminUsersPage() {
  const [pending, existing] = await Promise.all([
    prisma.user.findMany({
      where: { approvalStatus: "pending" },
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { approvalStatus: { not: "pending" } },
      select: { id: true, email: true, name: true, role: true, approvalStatus: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <ScreenScaffold
      eyebrow="Admin"
      title="Users"
      lede="Approve people who have registered, and set the role they get."
    >
      <SectionLabel weight={700} as="h2">
        Waiting for approval ({pending.length})
      </SectionLabel>

      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
        <div className="grid grid-cols-[1.6fr_1.4fr_1fr_1.4fr] bg-slate-900 text-white px-5 py-[13px] text-[11px] font-bold tracking-[0.12em] uppercase max-[900px]:hidden">
          <span>Name</span>
          <span>Email</span>
          <span>Requested</span>
          <span />
        </div>
        {pending.length === 0 ? (
          <p className="px-5 py-6 text-[13.5px] text-slate-500 text-center">Nobody is waiting. New signups appear here.</p>
        ) : (
          pending.map((u) => (
            <PendingRow
              key={u.id}
              id={u.id}
              name={u.name}
              email={u.email}
              requestedAt={dateFormat.format(u.createdAt)}
            />
          ))
        )}
      </div>

      <SectionLabel weight={700} as="h2">
        Everyone else ({existing.length})
      </SectionLabel>

      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
        <div className="grid grid-cols-[1.6fr_1.4fr_1fr_1.4fr] bg-slate-900 text-white px-5 py-[13px] text-[11px] font-bold tracking-[0.12em] uppercase max-[900px]:hidden">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Status</span>
        </div>
        {existing.length === 0 ? (
          <p className="px-5 py-6 text-[13.5px] text-slate-500 text-center">No accounts yet.</p>
        ) : (
          existing.map((u) => (
            <div className="grid grid-cols-[1.6fr_1.4fr_1fr_1.4fr] items-center border-t border-slate-200 px-5 py-[14px] text-[13.5px] text-slate-700 gap-3 even:bg-slate-100 max-[900px]:grid-cols-1 max-[900px]:gap-[6px]" key={u.id}>
              <span className="font-semibold text-slate-900">{u.name}</span>
              <span className="break-all">{u.email}</span>
              <span>
                <Badge tone={u.role === "admin" ? "blue" : "neutral"}>{u.role}</Badge>
              </span>
              <span>
                <Badge tone={u.approvalStatus === "approved" ? "green" : "red"}>
                  {u.approvalStatus}
                </Badge>
              </span>
            </div>
          ))
        )}
      </div>
    </ScreenScaffold>
  );
}
