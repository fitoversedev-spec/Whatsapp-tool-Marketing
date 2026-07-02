"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";

type Contact = {
  id: string;
  phone: string;
  name: string | null;
  allowCampaign: boolean;
  tagCount: number;
  createdAt: string;
};

type Group = { canonicalPhone: string; contacts: Contact[] };

export default function DuplicatesClient({ groups }: { groups: Group[] }) {
  const router = useRouter();
  const [primaryByGroup, setPrimaryByGroup] = useState<Record<string, string>>(
    Object.fromEntries(groups.map((g) => [g.canonicalPhone, g.contacts[0].id]))
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function merge(group: Group) {
    const primaryId = primaryByGroup[group.canonicalPhone];
    const secondaryIds = group.contacts.filter((c) => c.id !== primaryId).map((c) => c.id);
    if (
      !confirm(
        `Merge ${secondaryIds.length} duplicate${secondaryIds.length === 1 ? "" : "s"} into the selected primary? Tags will be unified. This cannot be undone.`
      )
    )
      return;
    setBusy(group.canonicalPhone);
    try {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId, secondaryIds }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Duplicate contacts"
        description={`${groups.length} duplicate group${groups.length === 1 ? "" : "s"} found · pick the primary contact to keep, others will be merged into it`}
        backHref="/contacts"
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        {groups.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <div className="text-4xl mb-2">✨</div>
            <h3 className="font-semibold text-slate-900">No duplicates detected</h3>
            <p className="text-sm text-slate-500 mt-1">
              Your contacts look clean. We&apos;ll re-scan on each visit.
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <div
              key={g.canonicalPhone}
              className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
            >
              <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-amber-900">
                    +{g.canonicalPhone}
                  </div>
                  <div className="text-xs text-amber-700">
                    {g.contacts.length} contacts with this phone
                  </div>
                </div>
                <button
                  onClick={() => merge(g)}
                  disabled={busy === g.canonicalPhone}
                  className="text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded disabled:opacity-50"
                >
                  {busy === g.canonicalPhone ? "Merging…" : "Merge"}
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {g.contacts.map((c) => {
                  const isPrimary = primaryByGroup[g.canonicalPhone] === c.id;
                  return (
                    <li key={c.id} className="px-4 py-3 flex items-center gap-3">
                      <input
                        type="radio"
                        name={`primary-${g.canonicalPhone}`}
                        checked={isPrimary}
                        onChange={() =>
                          setPrimaryByGroup((p) => ({
                            ...p,
                            [g.canonicalPhone]: c.id,
                          }))
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-900">
                          {c.name ?? <span className="text-slate-400">(no name)</span>}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-3 flex-wrap">
                          <span>+{c.phone}</span>
                          <span>·</span>
                          <span>
                            Added {new Date(c.createdAt).toLocaleDateString("en-IN")}
                          </span>
                          {c.tagCount > 0 && (
                            <>
                              <span>·</span>
                              <span>{c.tagCount} tag{c.tagCount === 1 ? "" : "s"}</span>
                            </>
                          )}
                          {!c.allowCampaign && (
                            <>
                              <span>·</span>
                              <span className="text-red-600">no campaign</span>
                            </>
                          )}
                        </div>
                      </div>
                      {isPrimary && (
                        <span className="text-[10px] uppercase tracking-wide font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                          Keep
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </>
  );
}
