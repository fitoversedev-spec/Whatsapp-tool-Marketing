import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Pending approval count — only fetch for admin so we don't waste queries
  let pendingCount = 0;
  if (user.role === "admin") {
    pendingCount = await prisma.user.count({
      where: { approvalStatus: "pending", deletedAt: null },
    });
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50">
      <Sidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role as "admin" | "sales",
        }}
        pendingCount={pendingCount}
      />
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
