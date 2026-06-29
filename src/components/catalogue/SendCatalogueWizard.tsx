"use client";

// Send-catalogue wizard. Two steps:
//   1. Pick sport + phone (+ optional caption + photo count)
//   2. Preview the catalogue PDF in an iframe; click Send
//
// On Send: POST /api/catalogues/[sport]/send which renders the PDF,
// uploads it to blob, sends as WhatsApp document, then sends each
// featured project's hero photo as a follow-up image message.

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";

const SPORT_OPTIONS = [
  { key: "football", label: "Football turf" },
  { key: "cricket", label: "Cricket" },
  { key: "basketball", label: "Basketball" },
  { key: "pickleball", label: "Pickleball" },
  { key: "tennis", label: "Tennis" },
  { key: "badminton", label: "Badminton" },
  { key: "volleyball", label: "Volleyball" },
  { key: "multisport", label: "Multisport" },
] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
  prefill?: {
    customerName?: string;
    contactPhone?: string;
    conversationId?: string;
  };
};

export default function SendCatalogueWizard({
  open,
  onClose,
  onComplete,
  prefill,
}: Props) {
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [sport, setSport] = useState<string>("football");
  const [contactPhone, setContactPhone] = useState(prefill?.contactPhone ?? "");
  const [caption, setCaption] = useState("");
  const [maxPhotos, setMaxPhotos] = useState(3);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSport("football");
    setContactPhone(prefill?.contactPhone ?? "");
    setCaption("");
    setMaxPhotos(3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function send() {
    if (!contactPhone.trim()) {
      toast.error("Enter a customer phone first");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/catalogues/${sport}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactPhone: contactPhone.trim(),
          caption: caption.trim() || undefined,
          conversationId: prefill?.conversationId ?? null,
          maxPhotos,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Send failed");
        return;
      }
      toast.success(
        `Catalogue sent to ${contactPhone}${
          data.sent > 1 ? ` (+${data.sent - 1} photos)` : ""
        }`
      );
      onComplete?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-stretch justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="font-semibold text-slate-900">Send Catalogue</div>
            <StepDot n={1} current={step} label="Pick" />
            <span className="text-slate-300">·</span>
            <StepDot n={2} current={step} label="Preview & send" />
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md hover:bg-slate-100"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {step === 1 && (
            <div className="p-6 sm:p-8 max-w-2xl mx-auto space-y-5">
              <section>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Sport</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SPORT_OPTIONS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setSport(s.key)}
                      className={`px-3 py-2.5 text-sm rounded-lg border transition ${
                        sport === s.key
                          ? "bg-wa-green/10 border-wa-green text-wa-dark font-medium"
                          : "bg-white border-slate-300 text-slate-700 hover:border-slate-400"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">
                  Sending to
                </h3>
                {prefill?.customerName && (
                  <div className="text-sm text-slate-700 mb-2">
                    {prefill.customerName}
                  </div>
                )}
                <label className="block">
                  <span className="text-[11px] text-slate-500 uppercase tracking-wide">
                    WhatsApp phone (E.164)
                  </span>
                  <input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+919876543210"
                    className="w-full mt-1 px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </label>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">
                  Caption{" "}
                  <span className="text-xs font-normal text-slate-500">
                    (attached to the catalogue PDF)
                  </span>
                </h3>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={3}
                  placeholder={`Defaults to "Fitoverse ${
                    SPORT_OPTIONS.find((s) => s.key === sport)?.label ?? sport
                  } catalogue. Reply with your plot size + location and we'll send a custom quote."`}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 resize-none"
                />
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">
                  Past-project photos
                </h3>
                <div className="flex items-center gap-2">
                  {[0, 1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setMaxPhotos(n)}
                      className={`px-3 py-1.5 text-sm rounded border ${
                        maxPhotos === n
                          ? "border-wa-green bg-wa-green/10 text-wa-dark"
                          : "border-slate-300 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {n === 0 ? "PDF only" : `+ ${n}`}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Sends the catalogue PDF + this many hero photos from featured
                  past {sport} projects as follow-up messages.
                </div>
              </section>

              <div className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded p-2.5 leading-relaxed">
                💡 Featured past projects are configured on the{" "}
                <a href="/portfolio" className="underline">
                  Portfolio page
                </a>
                . If no projects are featured for this sport, the PDF still ships
                — without the past-projects section.
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="h-full bg-slate-100 p-4">
              <iframe
                src={`/api/catalogues/${sport}/pdf`}
                className="w-full h-full rounded-lg shadow-lg bg-white"
                title="Catalogue preview"
              />
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep(1)}
                className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5"
            >
              Cancel
            </button>
            {step === 1 && (
              <button
                onClick={() => setStep(2)}
                disabled={!contactPhone.trim()}
                className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50"
              >
                Preview catalogue →
              </button>
            )}
            {step === 2 && (
              <button
                onClick={send}
                disabled={sending}
                className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50"
              >
                {sending ? "Sending…" : "📤 Send to WhatsApp"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepDot({
  n,
  current,
  label,
}: {
  n: number;
  current: number;
  label: string;
}) {
  const active = current === n;
  const done = current > n;
  return (
    <div className="flex items-center gap-2 text-xs">
      <div
        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
          active
            ? "bg-wa-green text-white"
            : done
              ? "bg-wa-green/15 text-wa-dark"
              : "bg-slate-200 text-slate-500"
        }`}
      >
        {n}
      </div>
      <span className={active ? "text-slate-900 font-medium" : "text-slate-500"}>
        {label}
      </span>
    </div>
  );
}
