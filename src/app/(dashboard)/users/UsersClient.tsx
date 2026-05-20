"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";

type User = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "sales";
  isActive: boolean;
  createdAt: string;
};

export default function UsersClient({ users }: { users: User[] }) {
  const router = useRouter();
  const [showInvite, setShowInvite] = useState(false);

  async function toggleActive(id: string, isActive: boolean) {
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage admin and sales team logins."
        action={
          <button
            onClick={() => setShowInvite(true)}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg transition w-full sm:w-auto"
          >
            + Invite user
          </button>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8">
        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {users.map((u) => (
            <div key={u.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{u.name}</div>
                  <div className="text-xs text-slate-500 truncate">{u.email}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {u.role}
                  </span>
                  {u.isActive ? (
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">
                      ACTIVE
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-600">
                      INACTIVE
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end">
                <button
                  onClick={() => toggleActive(u.id, u.isActive)}
                  className="text-sm text-slate-600 hover:text-slate-900 underline"
                >
                  {u.isActive ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{u.name}</td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          u.role === "admin"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-600">
                          INACTIVE
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleActive(u.id, u.isActive)}
                        className="text-xs text-slate-600 hover:text-slate-900 underline"
                      >
                        {u.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onCreated={() => router.refresh()} />}
    </>
  );
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "sales">("sales");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, role, password }),
    });
    setSaving(false);
    if (res.ok) {
      onCreated();
      onClose();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Create failed");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[95vh] overflow-y-auto"
      >
        <div className="p-5 sm:p-6 border-b border-slate-200">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">Invite user</h2>
        </div>
        <div className="p-5 sm:p-6 space-y-4">
          <Field label="Name" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" required />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              required
            />
          </Field>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as any)} className="input">
              <option value="sales">Sales</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Field label="Temporary password" required>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input font-mono"
              minLength={8}
              required
            />
          </Field>
        </div>
        <div className="p-5 sm:p-6 border-t border-slate-200 flex flex-col sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="order-2 sm:order-1 px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="order-1 sm:order-2 bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg"
          >
            {saving ? "Creating…" : "Create user"}
          </button>
        </div>
      </form>
      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          outline: none;
          font-size: 16px;
        }
        @media (min-width: 640px) {
          :global(.input) {
            font-size: 14px;
          }
        }
        :global(.input:focus) {
          border-color: #25d366;
          box-shadow: 0 0 0 3px rgba(37, 211, 102, 0.2);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
