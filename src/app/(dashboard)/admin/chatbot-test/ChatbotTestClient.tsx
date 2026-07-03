"use client";

// Chatbot dispatch sandbox — send a simulated inbound to your own
// phone, real WhatsApp messages get sent by the dispatcher. Shows the
// resulting flow state (current step, collected data). Use to step
// through the multi-turn flow without waiting for real webhook fires.

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

const MENU_IDS = [
  { id: "menu:turnkey_new", label: "Turnkey Projects" },
  { id: "menu:maintenance", label: "Maintenance" },
  { id: "menu:consultation", label: "Consultation" },
  { id: "menu:product", label: "Product Listing" },
];

const SPORT_IDS = [
  { id: "sport:football", label: "Football" },
  { id: "sport:cricket", label: "Cricket + Football" },
  { id: "sport:basketball", label: "Basketball" },
  { id: "sport:pickleball", label: "Pickleball" },
  { id: "sport:badminton", label: "Badminton" },
  { id: "sport:multisport", label: "Multisport" },
];

const MAINT_IDS = [
  { id: "maint:brushing", label: "Turf brushing" },
  { id: "maint:rubber_infill", label: "Rubber infill" },
  { id: "maint:silica_infill", label: "Rubber + silica infill" },
  { id: "maint:ppe_tiles", label: "PPE tile replacement" },
  { id: "maint:paint", label: "Primer & painting" },
  { id: "maint:net_post", label: "Net / post / fence" },
  { id: "maint:equipment", label: "Sports equipment" },
  { id: "maint:visit", label: "Expert visit" },
];

export default function ChatbotTestClient() {
  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("hi");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  async function fire(payload: { text?: string; replyId?: string; reset?: boolean }) {
    if (!phone) {
      toast.error("Enter a phone first");
      return;
    }
    const confirmMsg = payload.reset
      ? "This will close any active flow for that number. Continue?"
      : `This will send REAL WhatsApp messages to ${phone}. Continue?`;
    const ok = confirm(confirmMsg);
    if (!ok) return;
    setBusy(true);
    const r = await fetch("/api/chatbot/test-fire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, ...payload }),
    });
    setBusy(false);
    const j = await r.json();
    setResult(j);
    if (!r.ok) {
      toast.error(j.error ?? "Fire failed");
      return;
    }
    setHistory((h) => [
      { ts: new Date().toISOString(), payload, result: j },
      ...h.slice(0, 19),
    ]);
    if (payload.reset && !payload.text && !payload.replyId) {
      toast.success("Flow reset");
    } else if (j.flow?.endedAt) {
      toast.success(`Flow ended (${j.flow.endReason})`);
    } else if (j.flow?.currentStep) {
      toast.success(`Advanced to ${j.flow.currentStep}`);
    } else {
      toast.error("Flow not handled — check auto-reply rules");
    }
  }

  return (
    <>
      <PageHeader
        title="Chatbot sandbox"
        description="Step through the multi-turn WhatsApp chatbot. The dispatcher runs for real — messages actually get sent to the phone number below."
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl">
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Recipient phone (your own number for testing)
            </span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 93638 63382"
              className="input mt-1"
            />
          </label>
          <button
            type="button"
            onClick={() => fire({ reset: true })}
            disabled={busy}
            className="mt-3 text-xs text-red-600 hover:underline disabled:opacity-50"
          >
            Reset active flow for this number
          </button>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-3">
            Send text
          </h2>
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="hi"
              className="input flex-1"
            />
            <button
              type="button"
              onClick={() => fire({ text })}
              disabled={busy}
              className="bg-wa-green hover:bg-wa-green/90 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Try &quot;hi&quot; to start the flow. Then use the button panels
            below to simulate menu taps, or type text for name / phone /
            size steps.
          </div>
        </section>

        <ButtonPanel
          title="Menu picks (Phase 0)"
          options={MENU_IDS}
          onFire={(id) => fire({ replyId: id })}
          busy={busy}
        />

        <ButtonPanel
          title="Sport picks (Turnkey New Building)"
          options={SPORT_IDS}
          onFire={(id) => fire({ replyId: id })}
          busy={busy}
        />

        <ButtonPanel
          title="Maintenance service picks"
          options={MAINT_IDS}
          onFire={(id) => fire({ replyId: id })}
          busy={busy}
        />

        {result && (
          <section className="bg-slate-50 border border-slate-200 rounded-2xl p-5 sm:p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-2">
              Latest response
            </h2>
            <div className="text-sm space-y-1">
              <div>
                <span className="text-slate-500">handled:</span>{" "}
                <span className="font-mono">{String(result.handled)}</span>
              </div>
              {result.flow && (
                <>
                  <div>
                    <span className="text-slate-500">current step:</span>{" "}
                    <span className="font-mono">
                      {result.flow.currentStep}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">path:</span>{" "}
                    <span className="font-mono">
                      {result.flow.path ?? "(none)"}
                    </span>
                  </div>
                  {result.flow.endedAt && (
                    <div>
                      <span className="text-slate-500">ended:</span>{" "}
                      <span className="font-mono">
                        {result.flow.endReason}
                      </span>
                    </div>
                  )}
                  <div className="mt-2">
                    <div className="text-slate-500 text-xs uppercase tracking-wide mb-1">
                      Collected data
                    </div>
                    <pre className="bg-white border border-slate-200 rounded p-2 text-xs overflow-x-auto">
                      {JSON.stringify(result.flow.collectedData, null, 2)}
                    </pre>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              Turn history
            </h2>
            <ol className="space-y-1 text-xs">
              {history.map((h, i) => (
                <li
                  key={i}
                  className="border-b border-slate-100 pb-1 last:border-0"
                >
                  <span className="text-slate-400">
                    {new Date(h.ts).toLocaleTimeString("en-IN")}
                  </span>{" "}
                  <span className="text-slate-700">
                    →{" "}
                    {h.payload.reset
                      ? "reset"
                      : h.payload.replyId
                        ? `tap ${h.payload.replyId}`
                        : `text "${h.payload.text}"`}
                  </span>{" "}
                  <span className="text-slate-500">
                    →{" "}
                    {h.result.flow
                      ? h.result.flow.endedAt
                        ? `end (${h.result.flow.endReason})`
                        : h.result.flow.currentStep
                      : "no flow"}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </>
  );
}

function ButtonPanel({
  title,
  options,
  onFire,
  busy,
}: {
  title: string;
  options: Array<{ id: string; label: string }>;
  onFire: (id: string) => void;
  busy: boolean;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
      <h2 className="text-base font-semibold text-slate-900 mb-3">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onFire(o.id)}
            disabled={busy}
            className="bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium px-3 py-1.5 rounded-md disabled:opacity-50"
            title={o.id}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
