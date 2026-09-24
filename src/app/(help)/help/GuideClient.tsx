"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Role } from "@/lib/rbac";
import type { GuideEntry, GuideSectionId } from "@/lib/help/types";
import { GUIDE_SECTIONS, searchEntries } from "@/lib/help/registry";
import GuideCard from "@/components/help/GuideCard";
import GuideVideoOverview from "@/components/help/GuideVideoOverview";

type Props = {
  entries: GuideEntry[];
  initialSection: string | null;
  initialQuery: string;
  initialEntry: string | null;
  userRole: Role;
};

export default function GuideClient({
  entries,
  initialSection,
  initialQuery,
  initialEntry,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const activeSection = (searchParams.get("section") ?? initialSection) as GuideSectionId | null;
  const activeEntry = searchParams.get("entry") ?? initialEntry;

  const filtered = useMemo(() => {
    let result = entries;
    if (activeSection) {
      result = result.filter((e) => e.section === activeSection);
    }
    return searchEntries(result, query);
  }, [entries, activeSection, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, GuideEntry[]>();
    for (const e of filtered) {
      const key = e.category;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [filtered]);

  function setSection(section: GuideSectionId | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (section) {
      params.set("section", section);
    } else {
      params.delete("section");
    }
    params.delete("entry");
    router.replace(`/help?${params.toString()}`, { scroll: false });
  }

  function handleSearch(value: string) {
    setQuery(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("q", value);
    } else {
      params.delete("q");
    }
    router.replace(`/help?${params.toString()}`, { scroll: false });
  }

  const sectionCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length };
    for (const s of GUIDE_SECTIONS) {
      counts[s.id] = entries.filter((e) => e.section === s.id).length;
    }
    return counts;
  }, [entries]);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-heading font-bold text-2xl text-slate-900">Help Center</h1>
        <p className="text-sm text-slate-500 mt-1">
          Step-by-step guides for every feature. Click a guide to expand.
        </p>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search guides..."
            className="input pl-10 w-full"
          />
          {query && (
            <button
              onClick={() => handleSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {"✕"}
            </button>
          )}
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-1">
        <button
          onClick={() => setSection(null)}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
            !activeSection
              ? "bg-indigo-100 text-indigo-700"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          All <span className="text-xs opacity-70">({sectionCounts.all})</span>
        </button>
        {GUIDE_SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
              activeSection === s.id
                ? "bg-indigo-100 text-indigo-700"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <span>{s.icon}</span>
            <span>{s.label}</span>
            <span className="text-xs opacity-70">({sectionCounts[s.id] ?? 0})</span>
          </button>
        ))}
      </div>

      {/* Video overview (only when a section is selected) */}
      {activeSection && !query && (
        <GuideVideoOverview section={activeSection} />
      )}

      {/* Guide entries grouped by category */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-3xl mb-3">{"\u{1F50D}"}</div>
          <p className="text-slate-500 font-medium">No guides found</p>
          <p className="text-sm text-slate-400 mt-1">
            {query ? "Try a different search term" : "No guides available for this section yet"}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category}>
              <h2 className="font-heading font-bold text-xs uppercase tracking-wider text-slate-400 mb-2 px-1">
                {category}
              </h2>
              <div className="space-y-2">
                {items.map((entry) => (
                  <GuideCard
                    key={entry.slug}
                    entry={entry}
                    defaultOpen={activeEntry === entry.slug}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
