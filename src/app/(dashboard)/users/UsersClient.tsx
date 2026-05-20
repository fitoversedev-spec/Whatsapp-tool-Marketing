"use client";

import { useState, useMemo, FormEvent } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

type User = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "sales";
  isActive: boolean;
  approvalStatus: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  deletedAt: string | null;
  createdAt: string;
};

type TabId = "all" | "pending" | "approved" | "rejected" | "deleted";

const STATUS_TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "deleted", label: "Deleted" },
];

const STATUS_BADGES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export default function UsersClient({
  users,
  currentUserId,
}: {
  users: User[];
  currentUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [showInvite, setShowInvite] = useState(false);
  const [tab, setTab] = useState<TabId>("pending");
  const [approving, setApproving] = useState<User | null>(null);
  const [rejecting, setRejecting] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const counts = useMemo(() => {
    const c: Record<TabId, number> = {
      all: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      deleted: 0,
    };
    for (const u of users) {
      if (u.deletedAt) {
        c.deleted++;
      } else {
        c.all++;
        c[u.approvalStatus]++;
      }
    }
    return c;
  }, [users]);

  const filtered = useMemo(() => {
    if (tab === "deleted") return users.filter((u) => !!u.deletedAt);
    const nonDeleted = users.filter((u) => !u.deletedAt);
    if (tab === "all") return nonDeleted;
    return nonDeleted.filter((u) => u.approvalStatus === tab);
  }, [users, tab]);

  async function patch(id: string, body: Record<string, unknown>, successMsg?: string) {
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      if (successMsg) toast.success(successMsg);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Update failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage admin and sales team logins. Approve new signups before they can log in."
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
        {/* Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
          {STATUS_TABS.map((t) => {
            const active = tab === t.id;
            const count = counts[t.id];
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                  active
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span>{t.label}</span>
                <span
                  className={`text-[10px] font-bold rounded-full px-1.5 ${
                    active
                      ? "bg-white/20"
                      : t.id === "pending" && count > 0
                      ? "bg-amber-100 text-amber-700"
                      : t.id === "deleted" && count > 0
                      ? "bg-slate-200 text-slate-600"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center text-slate-500">
            {tab === "pending"
              ? "No pending approvals. New signups will appear here."
              : tab === "deleted"
              ? "No deleted users."
              : `No ${tab} users.`}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filtered.map((u) => (
                <UserCard
                  key={u.id}
                  user={u}
                  isSelf={u.id === currentUserId}
                  onApprove={() => setApproving(u)}
                  onReject={() => setRejecting(u)}
                  onToggleActive={() =>
                    patch(u.id, { isActive: !u.isActive }, u.isActive ? `${u.name} deactivated` : `${u.name} reactivated`)
                  }
                  onDelete={() => setDeleting(u)}
                  onRestore={() => patch(u.id, { deleted: false, isActive: true }, `${u.name} restored`)}
                />
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
                    {filtered.map((u) => (
                      <tr key={u.id} className={`hover:bg-slate-50 ${u.deletedAt ? "opacity-60" : ""}`}>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {u.name}
                          {u.id === currentUserId && (
                            <span className="ml-2 text-[10px] text-slate-400 uppercase">(you)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{u.email}</td>
                        <td className="px-4 py-3">
                          <RoleBadge role={u.role} />
                        </td>
                        <td className="px-4 py-3">
                          {u.deletedAt ? (
                            <div className="space-y-1">
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-200 text-slate-600">
                                DELETED
                              </span>
                              <div className="text-[10px] text-slate-500">
                                {new Date(u.deletedAt).toLocaleDateString()}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  STATUS_BADGES[u.approvalStatus]
                                }`}
                              >
                                {u.approvalStatus}
                              </span>
                              {u.approvalStatus === "approved" && !u.isActive && (
                                <span className="ml-1 inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-600">
                                  INACTIVE
                                </span>
                              )}
                              {u.approvalStatus === "rejected" && u.rejectionReason && (
                                <div className="text-xs text-slate-500 italic">
                                  {u.rejectionReason}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2 flex-wrap">
                            <UserActions
                              user={u}
                              isSelf={u.id === currentUserId}
                              onApprove={() => setApproving(u)}
                              onReject={() => setRejecting(u)}
                              onToggleActive={() =>
                                patch(
                                  u.id,
                                  { isActive: !u.isActive },
                                  u.isActive ? `${u.name} deactivated` : `${u.name} reactivated`
                                )
                              }
                              onDelete={() => setDeleting(u)}
                              onRestore={() =>
                                patch(u.id, { deleted: false, isActive: true }, `${u.name} restored`)
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onCreated={() => router.refresh()} />}
      {approving && (
        <ApproveModal
          user={approving}
          onClose={() => setApproving(null)}
          onConfirm={(role) => {
            patch(
              approving.id,
              { approvalStatus: "approved", role, rejectionReason: null },
              `${approving.name} approved as ${role}`
            );
            setApproving(null);
          }}
        />
      )}
      {rejecting && (
        <RejectModal
          user={rejecting}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => {
            patch(
              rejecting.id,
              { approvalStatus: "rejected", rejectionReason: reason || null },
              `${rejecting.name} rejected`
            );
            setRejecting(null);
          }}
        />
      )}
      {deleting && (
        <DeleteModal
          user={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            patch(deleting.id, { deleted: true }, `${deleting.name} deleted`);
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}

function RoleBadge({ role }: { role: "admin" | "sales" }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
        role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
      }`}
    >
      {role}
    </span>
  );
}

function UserCard({
  user,
  isSelf,
  onApprove,
  onReject,
  onToggleActive,
  onDelete,
  onRestore,
}: {
  user: User;
  isSelf: boolean;
  onApprove: () => void;
  onReject: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 ${user.deletedAt ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate flex items-center gap-2">
            <span>{user.name}</span>
            {isSelf && <span className="text-[10px] text-slate-400 uppercase">(you)</span>}
          </div>
          <div className="text-xs text-slate-500 truncate">{user.email}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <RoleBadge role={user.role} />
          {user.deletedAt ? (
            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-200 text-slate-600">
              DELETED
            </span>
          ) : (
            <>
              <span
                className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                  STATUS_BADGES[user.approvalStatus]
                }`}
              >
                {user.approvalStatus}
              </span>
              {user.approvalStatus === "approved" && !user.isActive && (
                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-600">
                  INACTIVE
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {user.deletedAt && (
        <div className="text-xs text-slate-500 mt-2 bg-slate-50 rounded p-2">
          Deleted on {new Date(user.deletedAt).toLocaleString()}
        </div>
      )}
      {!user.deletedAt && user.approvalStatus === "rejected" && user.rejectionReason && (
        <div className="text-xs text-slate-500 italic mt-2 bg-slate-50 rounded p-2">
          Reason: {user.rejectionReason}
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
        <UserActions
          user={user}
          isSelf={isSelf}
          onApprove={onApprove}
          onReject={onReject}
          onToggleActive={onToggleActive}
          onDelete={onDelete}
          onRestore={onRestore}
          mobile
        />
      </div>
    </div>
  );
}

function UserActions({
  user,
  isSelf,
  onApprove,
  onReject,
  onToggleActive,
  onDelete,
  onRestore,
}: {
  user: User;
  isSelf: boolean;
  onApprove: () => void;
  onReject: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onRestore: () => void;
  mobile?: boolean;
}) {
  if (isSelf) {
    return <span className="text-xs text-slate-400 italic">—</span>;
  }

  // Deleted row — show only Restore
  if (user.deletedAt) {
    return (
      <button
        onClick={onRestore}
        className="text-xs px-3 py-1.5 rounded-md bg-wa-green text-white hover:bg-wa-green/90 font-medium"
      >
        Restore
      </button>
    );
  }

  const buttons: React.ReactNode[] = [];

  if (user.approvalStatus === "pending") {
    buttons.push(
      <button
        key="reject"
        onClick={onReject}
        className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium"
      >
        Reject
      </button>,
      <button
        key="approve"
        onClick={onApprove}
        className="text-xs px-3 py-1.5 rounded-md bg-wa-green text-white hover:bg-wa-green/90 font-medium"
      >
        Approve
      </button>
    );
  } else if (user.approvalStatus === "rejected") {
    buttons.push(
      <button
        key="reapprove"
        onClick={onApprove}
        className="text-xs px-3 py-1.5 rounded-md bg-wa-green text-white hover:bg-wa-green/90 font-medium"
      >
        Re-approve
      </button>
    );
  } else {
    // approved
    buttons.push(
      <button
        key="toggleActive"
        onClick={onToggleActive}
        className="text-xs text-slate-600 hover:text-slate-900 underline"
      >
        {user.isActive ? "Deactivate" : "Reactivate"}
      </button>
    );
  }

  buttons.push(
    <button
      key="delete"
      onClick={onDelete}
      className="text-xs text-red-600 hover:text-red-700 hover:underline"
    >
      Delete
    </button>
  );

  return <>{buttons}</>;
}

// ────────────────────────────── Modals ───────────────────────────────────────

function ApproveModal({
  user,
  onClose,
  onConfirm,
}: {
  user: User;
  onClose: () => void;
  onConfirm: (role: "admin" | "sales") => void;
}) {
  const [role, setRole] = useState<"admin" | "sales">(user.role);
  return (
    <ModalShell title={`Approve ${user.name}`} onClose={onClose}>
      <p className="text-sm text-slate-600">
        They requested <strong>{user.role}</strong> access. You can keep that role or change it before approving.
      </p>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Grant role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "sales")}
          className="modal-input"
        >
          <option value="sales">Sales Representative</option>
          <option value="admin">Administrator</option>
        </select>
      </div>
      <ModalActions
        confirmLabel="Approve"
        confirmTone="green"
        onClose={onClose}
        onConfirm={() => onConfirm(role)}
      />
    </ModalShell>
  );
}

function RejectModal({
  user,
  onClose,
  onConfirm,
}: {
  user: User;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <ModalShell title={`Reject ${user.name}`} onClose={onClose}>
      <p className="text-sm text-slate-600">
        They won&apos;t be able to log in. You can re-approve them later if needed.
      </p>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Reason <span className="text-slate-400 font-normal">(optional, shown to user on login)</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="e.g. Not part of the marketing team"
          className="modal-input"
        />
      </div>
      <ModalActions
        confirmLabel="Reject"
        confirmTone="red"
        onClose={onClose}
        onConfirm={() => onConfirm(reason.trim())}
      />
    </ModalShell>
  );
}

function DeleteModal({
  user,
  onClose,
  onConfirm,
}: {
  user: User;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const matches = confirmText.trim().toLowerCase() === "delete";
  return (
    <ModalShell title={`Delete ${user.name}?`} onClose={onClose}>
      <p className="text-sm text-slate-600">
        This will <strong>soft-delete</strong> the user. They&apos;ll no longer be able to log in and won&apos;t appear in the active user list, but:
      </p>
      <ul className="text-sm text-slate-600 list-disc pl-5 space-y-1">
        <li>Their broadcasts, templates, and conversation history are preserved</li>
        <li>The email <code className="text-xs bg-slate-100 px-1 rounded">{user.email}</code> stays reserved</li>
        <li>An admin can restore them from the <strong>Deleted</strong> tab</li>
      </ul>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Type <code className="text-xs bg-slate-100 px-1 rounded">delete</code> to confirm
        </label>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="modal-input"
          placeholder="delete"
          autoFocus
        />
      </div>
      <ModalActions
        confirmLabel="Delete user"
        confirmTone="red"
        confirmDisabled={!matches}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[95vh] overflow-y-auto">
        <div className="p-5 sm:p-6 border-b border-slate-200">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">{title}</h2>
        </div>
        <div className="p-5 sm:p-6 space-y-4">{children}</div>
      </div>
      <style jsx>{`
        :global(.modal-input) {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          outline: none;
          font-size: 16px;
        }
        @media (min-width: 640px) {
          :global(.modal-input) {
            font-size: 14px;
          }
        }
        :global(.modal-input:focus) {
          border-color: #25d366;
          box-shadow: 0 0 0 3px rgba(37, 211, 102, 0.2);
        }
      `}</style>
    </div>
  );
}

function ModalActions({
  confirmLabel,
  confirmTone,
  confirmDisabled,
  onClose,
  onConfirm,
}: {
  confirmLabel: string;
  confirmTone: "green" | "red";
  confirmDisabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const cls =
    confirmTone === "green"
      ? "bg-wa-green hover:bg-wa-green/90"
      : "bg-red-600 hover:bg-red-700";
  return (
    <div className="pt-4 border-t border-slate-200 -mx-5 sm:-mx-6 px-5 sm:px-6 flex flex-col sm:flex-row sm:justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="order-2 sm:order-1 px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-lg"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={confirmDisabled}
        className={`order-1 sm:order-2 ${cls} disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-lg`}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
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
      toast.success(`Invited ${name}`);
      onCreated();
      onClose();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Create failed");
    }
  }

  return (
    <ModalShell title="Invite user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Admin-created users skip the approval step and can log in immediately.
        </p>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Name <span className="text-red-500">*</span>
          </label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="modal-input" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="modal-input"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "sales")}
            className="modal-input"
          >
            <option value="sales">Sales</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Temporary password <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="modal-input font-mono"
            minLength={8}
            required
          />
        </div>
        <div className="pt-4 border-t border-slate-200 -mx-5 sm:-mx-6 px-5 sm:px-6 flex flex-col sm:flex-row sm:justify-end gap-2">
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
    </ModalShell>
  );
}
