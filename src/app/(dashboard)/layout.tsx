import { requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50">
      <Sidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role as "admin" | "sales",
        }}
      />
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
