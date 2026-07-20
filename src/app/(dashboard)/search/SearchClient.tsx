"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";

type MessageHit = {
  id: string;
  conversationId: string;
  contactPhone: string;
  contactName: string | null;
  body: string;
  direction: string;
  createdAt: string;
};
type NoteHit = {
  id: string;
  conversationId: string;
  contactPhone: string;
  contactName: string | null;
  body: string;
  authorName: string;
  createdAt: string;
};
type ContactHit = { id: string; name: string | null; phone: string };
type TemplateHit = {
  id: string;
  name: string;
  bodySnippet: string;
  status: string;
  category: string;
};
type DealHit = { id: string; code: string; title: string; accountName: string; stageName: string; stageColorHex: string | null };
type AccountHit = { id: string; name: string; city: string | null };
type AccountContactHit = { id: string; name: string; phone: string | null; email: string | null; accountId: string; accountName: string };

type Results = {
  query: string;
  messages: MessageHit[];
  notes: NoteHit[];
  contacts: ContactHit[];
  templates: TemplateHit[];
  deals: DealHit[];
  accounts: AccountHit[];
  accountContacts: AccountContactHit[];
};

export default function SearchClient({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) setResults(await res.json());
      } finally {
        setLoading(false);
      }
      // Sync URL so the result is shareable / browser-back-able
      const next = new URLSearchParams(params.toString());
      next.set("q", q);
      router.replace(`/search?${next}`);
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const totalHits =
    (results?.messages.length ?? 0) +
    (results?.notes.length ?? 0) +
    (results?.contacts.length ?? 0) +
    (results?.templates.length ?? 0) +
    (results?.deals.length ?? 0) +
    (results?.accounts.length ?? 0) +
    (results?.accountContacts.length ?? 0);

  return (
    <>
      <PageHeader
        title="Search"
        description="Across messages, notes, contacts, and templates"
      />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="relative">
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search…"
            className="w-full px-4 py-3 text-base border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green pl-11"
          />
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg">🔍</span>
          {loading && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400">
              Searching…
            </span>
          )}
        </div>

        {!results && (
          <EmptyHint>
            Try searching for a phone number, customer name, message text, or template name.
          </EmptyHint>
        )}

        {results && totalHits === 0 && (
          <EmptyHint>No results for &ldquo;{results.query}&rdquo;.</EmptyHint>
        )}

        {results && results.messages.length > 0 && (
          <Section title={`Messages (${results.messages.length})`} icon="💬">
            {results.messages.map((m) => (
              <Link
                key={m.id}
                href={`/inbox?conversation=${m.conversationId}`}
                className="block px-4 py-3 hover:bg-slate-50 border-t border-slate-100 first:border-t-0"
              >
                <div className="text-sm text-slate-900 line-clamp-2">
                  <Highlight text={m.body} query={results.query} />
                </div>
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                  <span className="font-medium">
                    {m.contactName ?? "+" + m.contactPhone}
                  </span>
                  <span>·</span>
                  <span>{m.direction === "inbound" ? "← inbound" : "→ outbound"}</span>
                  <span>·</span>
                  <span>{new Date(m.createdAt).toLocaleString("en-IN")}</span>
                </div>
              </Link>
            ))}
          </Section>
        )}

        {results && results.notes.length > 0 && (
          <Section title={`Notes (${results.notes.length})`} icon="📝">
            {results.notes.map((n) => (
              <Link
                key={n.id}
                href={`/inbox?conversation=${n.conversationId}`}
                className="block px-4 py-3 hover:bg-slate-50 border-t border-slate-100 first:border-t-0"
              >
                <div className="text-sm text-slate-900 line-clamp-2">
                  <Highlight text={n.body} query={results.query} />
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  by {n.authorName} on {n.contactName ?? "+" + n.contactPhone} ·{" "}
                  {new Date(n.createdAt).toLocaleDateString("en-IN")}
                </div>
              </Link>
            ))}
          </Section>
        )}

        {results && results.deals.length > 0 && (
          <Section title={`Deals (${results.deals.length})`} icon="📁">
            {results.deals.map((d) => (
              <Link key={d.id} href={`/deals/${d.id}`} className="block px-4 py-3 hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
                <div className="text-sm font-medium text-slate-900 flex items-center gap-2">
                  <Highlight text={d.title} query={results.query} />
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ background: (d.stageColorHex ?? "#64748b") + "20", color: d.stageColorHex ?? "#475569" }}
                  >
                    {d.stageName}
                  </span>
                </div>
                <div className="text-xs text-slate-500">{d.code} · {d.accountName}</div>
              </Link>
            ))}
          </Section>
        )}

        {results && results.accounts.length > 0 && (
          <Section title={`Companies (${results.accounts.length})`} icon="🏢">
            {results.accounts.map((a) => (
              <Link key={a.id} href={`/crm/companies/${a.id}`} className="block px-4 py-3 hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
                <div className="text-sm font-medium text-slate-900"><Highlight text={a.name} query={results.query} /></div>
                {a.city && <div className="text-xs text-slate-500">{a.city}</div>}
              </Link>
            ))}
          </Section>
        )}

        {results && results.accountContacts.length > 0 && (
          <Section title={`CRM contacts (${results.accountContacts.length})`} icon="🧑">
            {results.accountContacts.map((c) => (
              <Link key={c.id} href={`/crm/contacts/${c.id}`} className="block px-4 py-3 hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
                <div className="text-sm font-medium text-slate-900"><Highlight text={c.name} query={results.query} /></div>
                <div className="text-xs text-slate-500">{c.accountName}{c.phone ? ` · ${c.phone}` : ""}</div>
              </Link>
            ))}
          </Section>
        )}

        {results && results.contacts.length > 0 && (
          <Section title={`Contacts (${results.contacts.length})`} icon="📒">
            {results.contacts.map((c) => (
              <Link
                key={c.id}
                href={`/contacts/${c.id}`}
                className="block px-4 py-3 hover:bg-slate-50 border-t border-slate-100 first:border-t-0"
              >
                <div className="text-sm font-medium text-slate-900">
                  <Highlight text={c.name ?? "(no name)"} query={results.query} />
                </div>
                <div className="text-xs text-slate-500">+{c.phone}</div>
              </Link>
            ))}
          </Section>
        )}

        {results && results.templates.length > 0 && (
          <Section title={`Templates (${results.templates.length})`} icon="📝">
            {results.templates.map((t) => (
              <Link
                key={t.id}
                href={`/templates`}
                className="block px-4 py-3 hover:bg-slate-50 border-t border-slate-100 first:border-t-0"
              >
                <div className="text-sm font-medium text-slate-900 flex items-center gap-2">
                  <Highlight text={t.name} query={results.query} />
                  <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                    {t.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1 line-clamp-1">
                  <Highlight text={t.bodySnippet} query={results.query} />
                </div>
              </Link>
            ))}
          </Section>
        )}
      </div>
    </>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
        <span>{icon}</span>
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQ = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQ);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200 dark:bg-amber-700 dark:text-amber-100 px-0.5 rounded">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}
