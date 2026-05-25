"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import type { ConnectionStatus } from "@/lib/meta-connection";

const QUALITY_COLORS: Record<string, string> = {
  GREEN: "bg-green-100 text-green-800",
  YELLOW: "bg-amber-100 text-amber-800",
  RED: "bg-red-100 text-red-800",
  UNKNOWN: "bg-slate-100 text-slate-700",
};

export default function ConnectionClient({ status }: { status: ConnectionStatus }) {
  const router = useRouter();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function syncTemplates() {
    setSyncing(true);
    const res = await fetch("/api/connection/sync-templates", { method: "POST" });
    setSyncing(false);
    const data = await res.json();
    if (res.ok) {
      toast.success(`Synced ${data.total} templates (${data.added} new, ${data.updated} updated)`);
      router.refresh();
    } else {
      toast.error(data.error ?? "Sync failed");
    }
  }

  async function refresh() {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 1200);
  }

  const isConfigured = status.configured;
  const phone = status.phone;
  const waba = status.waba;
  const profile = status.profile;
  const templates = status.templates ?? [];
  const errors = status.errors ?? [];

  return (
    <>
      <PageHeader
        title="WhatsApp Connection"
        description="Live status of your Meta Cloud API connection."
        action={
          <button
            onClick={refresh}
            disabled={refreshing}
            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium px-4 py-2 rounded-lg transition w-full sm:w-auto"
          >
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl">
        {/* Overall health */}
        <div
          className={`rounded-2xl border p-4 sm:p-5 flex items-start gap-3 ${
            !isConfigured
              ? "bg-amber-50 border-amber-200"
              : errors.length > 0
              ? "bg-red-50 border-red-200"
              : "bg-green-50 border-green-200"
          }`}
        >
          <div className="text-2xl">
            {!isConfigured ? "⚠️" : errors.length > 0 ? "🚫" : "✅"}
          </div>
          <div className="flex-1">
            <div className="font-semibold text-slate-900">
              {!isConfigured
                ? "Meta credentials not configured"
                : errors.length > 0
                ? "Connected with issues"
                : "Connected — all checks passed"}
            </div>
            <div className="text-sm text-slate-600 mt-0.5">
              {!isConfigured
                ? "Set META_PHONE_NUMBER_ID, META_WABA_ID, and META_ACCESS_TOKEN in .env"
                : errors.length > 0
                ? `${errors.length} issue${errors.length > 1 ? "s" : ""} below`
                : `${phone?.displayNumber ?? ""} ready to send`}
            </div>
            {errors.length > 0 && (
              <ul className="text-xs text-red-700 mt-2 list-disc pl-5 space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Phone number */}
        {phone && (
          <Card title="Phone number" subtitle="Live from Meta Cloud API">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Stat label="Display number" value={phone.displayNumber} mono />
              <Stat label="Verified name" value={phone.verifiedName} />
              <Stat label="Phone Number ID" value={phone.id} mono small />
              <Stat label="Platform" value={phone.platformType ?? "—"} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge className={QUALITY_COLORS[phone.qualityRating] ?? "bg-slate-100"}>
                ● Quality: {phone.qualityRating}
              </Badge>
              <Badge className="bg-blue-100 text-blue-800">
                Tier: {phone.messagingLimitTier?.replace("TIER_", "") ?? "—"} per 24h
              </Badge>
              {phone.nameStatus && (
                <Badge className="bg-slate-100 text-slate-700">Name: {phone.nameStatus}</Badge>
              )}
              {phone.codeVerificationStatus && (
                <Badge className="bg-slate-100 text-slate-700">
                  Code: {phone.codeVerificationStatus}
                </Badge>
              )}
            </div>
          </Card>
        )}

        {/* Business account */}
        {waba && (
          <Card title="WhatsApp Business Account" subtitle="Account-level configuration">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Stat label="Name" value={waba.name} />
              <Stat label="WABA ID" value={waba.id} mono small />
              {waba.currency && <Stat label="Currency" value={waba.currency} />}
              {waba.timezoneId && <Stat label="Timezone ID" value={waba.timezoneId} />}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {waba.namespace && (
                <Badge className="bg-slate-100 text-slate-700">
                  Namespace: {waba.namespace.slice(0, 8)}…
                </Badge>
              )}
            </div>
            <div className="mt-3 text-xs text-slate-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1.5">
              <div className="font-semibold text-amber-900">⚠ Payment method (manual check)</div>
              <div>
                Meta restricts payment-status queries to Business Solution Provider apps, so we can&apos;t
                check it from here. Verify in <strong>Meta Business Manager → WhatsApp Accounts → this WABA → Payment methods</strong>.
              </div>
              <div>
                Without a payment method, business-initiated messages (marketing broadcasts) will fail with{" "}
                <code className="bg-white px-1 rounded">131056</code>. Inbound replies still work normally
                even without payment.
              </div>
            </div>
          </Card>
        )}

        {/* Business profile */}
        {profile && (profile.about || profile.websites?.length || profile.address) && (
          <Card title="Business profile" subtitle="Shown to customers in WhatsApp">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {profile.about && <Stat label="About" value={profile.about} multiline />}
              {profile.description && <Stat label="Description" value={profile.description} multiline />}
              {profile.email && <Stat label="Email" value={profile.email} />}
              {profile.vertical && <Stat label="Industry" value={profile.vertical} />}
              {profile.address && <Stat label="Address" value={profile.address} multiline />}
              {profile.websites && profile.websites.length > 0 && (
                <Stat label="Websites" value={profile.websites.join(", ")} multiline />
              )}
            </div>
          </Card>
        )}

        {/* Templates */}
        <Card
          title={`Templates (${templates.length})`}
          subtitle="Synced from Meta. Click below to refresh the local cache."
          action={
            <button
              onClick={syncTemplates}
              disabled={syncing}
              className="bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm"
            >
              {syncing ? "Syncing…" : "↓ Sync from Meta"}
            </button>
          }
        >
          {templates.length === 0 ? (
            <div className="text-sm text-slate-500 p-2">No templates yet. Submit one from the Templates page.</div>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => (
                <div
                  key={t.metaTemplateId}
                  className="border border-slate-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 truncate">{t.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {t.category} · {t.language}
                    </div>
                    {t.body && (
                      <div className="text-xs text-slate-600 mt-1.5 font-mono bg-slate-50 border border-slate-100 rounded p-1.5 break-words">
                        {t.body}
                      </div>
                    )}
                  </div>
                  <Badge
                    className={
                      t.status === "APPROVED"
                        ? "bg-green-100 text-green-800"
                        : t.status === "REJECTED"
                        ? "bg-red-100 text-red-800"
                        : t.status === "PAUSED"
                        ? "bg-orange-100 text-orange-800"
                        : "bg-blue-100 text-blue-800"
                    }
                  >
                    {t.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Webhook setup */}
        <Card title="Webhook" subtitle="Receive delivery statuses, inbound replies, and template approvals">
          <div className="space-y-2.5">
            <Stat
              label="App Secret in env"
              value={status.webhook.appSecretSet ? "✓ set (signature verification active)" : "⚠ missing"}
            />
            <Stat
              label="Verify token in env"
              value={status.webhook.verifyTokenSet ? "✓ set" : "⚠ missing"}
            />
            <Stat label="Graph API version" value={status.webhook.apiVersion} />
            <Stat
              label="Callback path"
              value={status.webhook.callbackPath}
              mono
            />
          </div>
          <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 space-y-2">
            <div className="font-semibold text-slate-900">How to register the webhook in Meta</div>
            <ol className="list-decimal pl-5 space-y-1">
              <li>
                Expose this server with HTTPS: <code className="bg-white px-1 rounded">ngrok http 3000</code>{" "}
                (for production: use the Vercel URL)
              </li>
              <li>
                Meta dashboard → your App → <strong>WhatsApp → Configuration → Webhooks → Edit</strong>
              </li>
              <li>
                Callback URL:{" "}
                <code className="bg-white px-1 rounded">https://&lt;your-host&gt;/api/webhooks/whatsapp</code>
              </li>
              <li>Verify token: the value of <code className="bg-white px-1 rounded">META_WEBHOOK_VERIFY_TOKEN</code> in your .env</li>
              <li>
                Subscribe to fields: <strong>messages</strong> and <strong>message_template_status_update</strong>
              </li>
            </ol>
          </div>
        </Card>

        {/* Token info */}
        {status.tokenInfo && (
          <Card title="Access token" subtitle="Diagnostic — token diagnostics from Meta">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Stat label="Valid" value={status.tokenInfo.valid ? "✓ yes" : "✗ no"} />
              <Stat label="Token type" value={status.tokenInfo.type ?? "—"} />
              <Stat label="App ID" value={status.tokenInfo.appId ?? "—"} mono small />
              <Stat
                label="Expires"
                value={
                  status.tokenInfo.expiresAt
                    ? new Date(status.tokenInfo.expiresAt * 1000).toLocaleString()
                    : "Never"
                }
              />
            </div>
            {status.tokenInfo.scopes && status.tokenInfo.scopes.length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-slate-500 mb-1">Scopes</div>
                <div className="flex flex-wrap gap-1.5">
                  {status.tokenInfo.scopes.map((s) => (
                    <span
                      key={s}
                      className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  mono,
  small,
  multiline,
}: {
  label: string;
  value: string | undefined;
  mono?: boolean;
  small?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div
        className={`text-slate-900 ${mono ? "font-mono" : "font-medium"} ${
          small ? "text-xs" : "text-sm"
        } ${multiline ? "whitespace-pre-wrap break-words" : "truncate"}`}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-block px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}
