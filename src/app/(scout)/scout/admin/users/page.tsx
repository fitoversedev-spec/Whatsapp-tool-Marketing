import type { Metadata } from "next";
import { Badge } from "@/components/scout/ui";
import { ScreenScaffold, SectionLabel } from "@/components/scout/patterns";
import { prisma } from "@/lib/prisma";
import { PendingRow } from "./PendingRow";
import styles from "./users.module.css";

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

      <div className={styles.table}>
        <div className={styles.head}>
          <span>Name</span>
          <span>Email</span>
          <span>Requested</span>
          <span />
        </div>
        {pending.length === 0 ? (
          <p className={styles.empty}>Nobody is waiting. New signups appear here.</p>
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

      <div className={styles.table}>
        <div className={styles.head}>
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Status</span>
        </div>
        {existing.length === 0 ? (
          <p className={styles.empty}>No accounts yet.</p>
        ) : (
          existing.map((u) => (
            <div className={styles.row} key={u.id}>
              <span className={styles.name}>{u.name}</span>
              <span className={styles.email}>{u.email}</span>
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
