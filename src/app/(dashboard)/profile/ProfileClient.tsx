"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import type { Role } from "@/lib/rbac";

export default function ProfileClient({
  user,
}: {
  user: {
    name: string;
    email: string;
    role: Role;
    preferredUnit: "ft" | "m";
    phone: string | null;
    pushEnabled: boolean;
    vapidPublicKey: string | null;
  };
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [savingName, setSavingName] = useState(false);

  const [phone, setPhone] = useState(user.phone ?? "");
  const [savingPhone, setSavingPhone] = useState(false);

  const [preferredUnit, setPreferredUnit] = useState<"ft" | "m">(user.preferredUnit);
  const [savingUnit, setSavingUnit] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(user.pushEnabled);
  const [togglingPush, setTogglingPush] = useState(false);

  async function saveUnit(unit: "ft" | "m") {
    if (unit === preferredUnit) return;
    setSavingUnit(true);
    setPreferredUnit(unit);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredUnit: unit }),
    });
    setSavingUnit(false);
    if (res.ok) {
      toast.success(`Unit set to ${unit === "ft" ? "feet" : "meters"}`);
      // Reload so any open wizards / server-rendered dims re-fetch the
      // fresh preference from /api/auth/me on next mount.
      router.refresh();
    } else {
      setPreferredUnit(user.preferredUnit);
      toast.error("Failed to update unit");
    }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === user.name) {
      toast.info("No changes to save");
      return;
    }
    setSavingName(true);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setSavingName(false);
    if (res.ok) {
      toast.success("Name updated");
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to update name");
    }
  }

  async function savePhone(e: FormEvent) {
    e.preventDefault();
    const trimmed = phone.trim();
    if (trimmed === (user.phone ?? "")) {
      toast.info("No changes to save");
      return;
    }
    setSavingPhone(true);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: trimmed }),
    });
    setSavingPhone(false);
    if (res.ok) {
      toast.success(trimmed ? "WhatsApp number saved" : "WhatsApp number removed");
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to update number");
    }
  }

  async function togglePush() {
    if (!user.vapidPublicKey) {
      toast.error("Push notifications are not configured on this server");
      return;
    }
    setTogglingPush(true);
    try {
      if (!pushEnabled) {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.error("Notification permission denied by browser");
          setTogglingPush(false);
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(user.vapidPublicKey),
        });
        const json = sub.toJSON();
        const res = await fetch("/api/push-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            deviceLabel: navigator.userAgent.slice(0, 100),
          }),
        });
        if (!res.ok) throw new Error("subscribe failed");
        setPushEnabled(true);
        toast.success("Push notifications enabled");
      } else {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/push-subscription", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        } else {
          await fetch("/api/push-subscription", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        }
        setPushEnabled(false);
        toast.success("Push notifications disabled");
      }
    } catch {
      toast.error("Failed to update push notifications");
    }
    setTogglingPush(false);
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    setChangingPassword(true);
    const res = await fetch("/api/profile/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setChangingPassword(false);
    if (res.ok) {
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to change password");
    }
  }

  return (
    <>
      <PageHeader title="My profile" description="Manage your account details and password." />

      <div className="p-4 sm:p-6 lg:p-8 max-w-2xl space-y-6">
        {/* Account info */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Account</h2>
          <p className="text-xs text-slate-500 mb-4">Read-only details about your account.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ReadOnly label="Email" value={user.email} />
            <ReadOnly label="Role" value={user.role} />
          </div>
        </div>

        {/* Name */}
        <form
          onSubmit={saveName}
          className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900 mb-1">Display name</h2>
            <p className="text-xs text-slate-500">Shown to teammates in the inbox and audit trail.</p>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none text-base sm:text-sm"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingName}
              className="bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg"
            >
              {savingName ? "Saving…" : "Save"}
            </button>
          </div>
        </form>

        {/* WhatsApp number for bot commands */}
        <form
          onSubmit={savePhone}
          className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900 mb-1">WhatsApp bot commands</h2>
            <p className="text-xs text-slate-500">
              Link the number you'll text the business number from to use commands like "my day", "remind", and "deal &lt;code&gt;". Leave blank to disable.
            </p>
          </div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 919876543210"
            className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none text-base sm:text-sm"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingPhone}
              className="bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg"
            >
              {savingPhone ? "Saving…" : "Save"}
            </button>
          </div>
        </form>

        {/* Push notifications */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 mb-1">Push notifications</h2>
            <p className="text-xs text-slate-500">
              Receive push notifications for reminders and new WhatsApp messages on this device.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={togglePush}
              disabled={togglingPush || !("serviceWorker" in navigator)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-wa-green/20 disabled:opacity-50 ${
                pushEnabled ? "bg-wa-green" : "bg-slate-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  pushEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-sm text-slate-700">
              {togglingPush ? "Updating…" : pushEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          {!("serviceWorker" in (typeof navigator !== "undefined" ? navigator : {})) && (
            <p className="text-xs text-amber-600">Push notifications are not supported in this browser.</p>
          )}
        </div>

        {/* Preferred dimension unit */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 mb-1">
              Preferred dimension unit
            </h2>
            <p className="text-xs text-slate-500">
              Applies to Court Designer, quotation line items, and portfolio
              dimensions. Exported PDFs always show both units for the
              customer regardless of your choice.
            </p>
          </div>
          <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => saveUnit("ft")}
              disabled={savingUnit}
              className={`px-4 py-2 text-sm font-medium rounded-md transition ${
                preferredUnit === "ft"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Feet (ft)
            </button>
            <button
              type="button"
              onClick={() => saveUnit("m")}
              disabled={savingUnit}
              className={`px-4 py-2 text-sm font-medium rounded-md transition ${
                preferredUnit === "m"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Meters (m)
            </button>
          </div>
        </div>

        {/* Change password */}
        <form
          onSubmit={changePassword}
          className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900 mb-1">Change password</h2>
            <p className="text-xs text-slate-500">At least 6 characters. You stay signed in after changing.</p>
          </div>

          <Field label="Current password" required>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none text-base sm:text-sm"
            />
          </Field>

          <Field label="New password" required>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none text-base sm:text-sm"
            />
          </Field>

          <Field label="Confirm new password" required>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none text-base sm:text-sm"
            />
          </Field>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg"
            >
              {changingPassword ? "Updating…" : "Change password"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-sm text-slate-900 font-medium break-all">{value}</div>
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

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}
