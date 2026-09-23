"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  account?: { name: string } | null;
};

export default function ShareInsightModal({
  docId,
  docTitle,
  onClose,
}: {
  docId: string;
  docTitle: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"link" | "download" | "whatsapp">("link");
  const [link, setLink] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [waLoading, setWaLoading] = useState(false);
  const [phone, setPhone] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [showContacts, setShowContacts] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const searchContacts = useCallback((q: string) => {
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setContacts([]); setShowContacts(false); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/account-contacts?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();
        const withPhone = (data.contacts ?? []).filter((c: Contact) => c.phone);
        setContacts(withPhone.slice(0, 10));
        setShowContacts(true);
      } catch { /* ignore */ }
    }, 300);
  }, []);

  async function generateLink() {
    setLinkLoading(true);
    try {
      const res = await fetch(`/api/insights/${docId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link" }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLink(data.url);
    } catch {
      toast.error("Could not generate link");
    } finally {
      setLinkLoading(false);
    }
  }

  async function copyLink() {
    if (!link) await generateLink();
    if (link) {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied to clipboard");
    }
  }

  async function downloadPdf() {
    setDownloadLoading(true);
    try {
      const res = await fetch(`/api/insights/${docId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download" }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${docTitle.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Insight"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch {
      toast.error("Could not generate PDF");
    } finally {
      setDownloadLoading(false);
    }
  }

  async function sendWhatsApp() {
    const cleaned = phone.replace(/[^0-9]/g, "");
    if (cleaned.length < 10) {
      toast.error("Enter a valid phone number");
      return;
    }
    setWaLoading(true);
    try {
      const res = await fetch(`/api/insights/${docId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "whatsapp", to: cleaned }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "failed");
      }
      toast.success("Document sent via WhatsApp");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed";
      if (msg === "whatsapp_not_configured") {
        toast.error("WhatsApp is not configured");
      } else {
        toast.error("Could not send via WhatsApp");
      }
    } finally {
      setWaLoading(false);
    }
  }

  function selectContact(contact: Contact) {
    setPhone(contact.phone ?? "");
    setContactQuery(contact.name);
    setShowContacts(false);
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={modalRef}
        className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Share Document</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200">
          {(["link", "download", "whatsapp"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                tab === t
                  ? "text-slate-900 border-b-2 border-slate-900"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "link" ? "Copy Link" : t === "download" ? "Download PDF" : "WhatsApp"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5">
          {tab === "link" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Generate a public link anyone can open without logging in.
              </p>
              {link ? (
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={link}
                    className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded px-3 py-2 text-slate-700 truncate"
                  />
                  <button
                    onClick={copyLink}
                    className="shrink-0 bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded hover:bg-slate-800"
                  >
                    Copy
                  </button>
                </div>
              ) : (
                <button
                  onClick={async () => { await generateLink(); }}
                  disabled={linkLoading}
                  className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded hover:bg-slate-800 disabled:opacity-50"
                >
                  {linkLoading ? "Generating..." : "Generate Link"}
                </button>
              )}
            </div>
          )}

          {tab === "download" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Download as a PDF file you can share anywhere.
              </p>
              <button
                onClick={downloadPdf}
                disabled={downloadLoading}
                className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded hover:bg-slate-800 disabled:opacity-50"
              >
                {downloadLoading ? "Generating PDF..." : "Download PDF"}
              </button>
            </div>
          )}

          {tab === "whatsapp" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Send the document as a PDF attachment via WhatsApp.
              </p>

              {/* Contact search */}
              <div className="relative">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Search CRM Contact
                </label>
                <input
                  value={contactQuery}
                  onChange={(e) => {
                    setContactQuery(e.target.value);
                    searchContacts(e.target.value);
                  }}
                  onFocus={() => contacts.length > 0 && setShowContacts(true)}
                  placeholder="Type a contact name..."
                  className="w-full text-sm border border-slate-200 rounded px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                {showContacts && contacts.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded shadow-lg max-h-48 overflow-y-auto">
                    {contacts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectContact(c)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      >
                        <div className="text-sm font-medium text-slate-800">{c.name}</div>
                        <div className="text-xs text-slate-500">
                          {c.phone} {c.account?.name ? `· ${c.account.name}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Manual phone */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Or enter phone number
                </label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="91XXXXXXXXXX"
                  className="w-full text-sm border border-slate-200 rounded px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <button
                onClick={sendWhatsApp}
                disabled={waLoading || !phone.replace(/[^0-9]/g, "")}
                className="w-full bg-green-600 text-white text-sm font-medium px-4 py-2.5 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {waLoading ? "Sending..." : "Send via WhatsApp"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
