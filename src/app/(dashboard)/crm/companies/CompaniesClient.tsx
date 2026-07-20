"use client";

import { useMemo, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

type Company = {
  id: string;
  name: string;
  city: string | null;
  businessType: string | null;
  customerProfileName: string | null;
  leadSourceNames: string[];
  ownerName: string | null;
  dealCount: number;
  contactCount: number;
  updatedAt: string;
};

type Option = { id: string; name: string };

const UNCLASSIFIED = "Unclassified";

type Dimension = "customerType" | "businessType" | "leadSource" | "city";
const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "customerType", label: "Customer type" },
  { key: "businessType", label: "Business type" },
  { key: "leadSource", label: "Lead source" },
  { key: "city", label: "City" },
];

// A real multi-contact organization still gets its own record (a school, a
// hotel chain) — but most customers are individuals, so instead of browsing
// a flat list of (mostly auto-named, one-per-person) accounts, this groups
// them into filterable segments: customer type, business type, lead source,
// city. See docs/DECISIONS.md.
export default function CompaniesClient({
  isAdmin,
  companies,
  customerProfiles,
}: {
  isAdmin: boolean;
  companies: Company[];
  customerProfiles: Option[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [dimension, setDimension] = useState<Dimension>("customerType");
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

  function bucketKeysFor(c: Company, dim: Dimension): string[] {
    if (dim === "leadSource") return c.leadSourceNames.length ? c.leadSourceNames : [UNCLASSIFIED];
    const value = dim === "customerType" ? c.customerProfileName : dim === "businessType" ? c.businessType : c.city;
    return [value ?? UNCLASSIFIED];
  }

  const buckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of companies) {
      for (const key of bucketKeysFor(c, dimension)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [companies, dimension]);

  function selectDimension(dim: Dimension) {
    setDimension(dim);
    setSelectedBucket(null);
  }

  const visible = companies.filter((c) => {
    const matchesBucket = !selectedBucket || bucketKeysFor(c, dimension).includes(selectedBucket);
    const matchesSearch = !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase());
    return matchesBucket && matchesSearch;
  });

  // The table's classification column tracks whichever dimension is
  // currently selected — it used to always read "Customer type" no matter
  // which tab you were on, so browsing by Business type or Lead source
  // showed a column that didn't match what you'd just filtered by.
  const classificationLabel = dimension === "businessType" ? "Business type" : dimension === "leadSource" ? "Lead source" : "Customer type";
  function classificationValue(c: Company): string {
    if (dimension === "businessType") return c.businessType ?? "—";
    if (dimension === "leadSource") return c.leadSourceNames.length ? c.leadSourceNames.join(", ") : "—";
    return c.customerProfileName ?? "—";
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Lead types"
        description={`${companies.length} ${isAdmin ? "" : "of yours "}on record — grouped by who they are, not a flat company list`}
        action={
          <button
            onClick={() => setShowNew(true)}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm"
          >
            + New Organization
          </button>
        }
      />

      {/* Group by — a tab strip (like Overview/Timeline elsewhere), so it
          reads as "pick what to group by", distinct from the filter chips
          below it rather than a second row of the same kind of control. */}
      <div className="flex gap-1 border-b border-slate-200 mb-3">
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            onClick={() => selectDimension(d.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              dimension === d.key ? "border-wa-green text-wa-dark" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Filter to one group within the dimension above */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => setSelectedBucket(null)}
          className={`text-xs px-2.5 py-1 rounded-full border ${
            !selectedBucket ? "bg-wa-dark text-white border-wa-dark" : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          All ({companies.length})
        </button>
        {buckets.map(([name, count]) => (
          <button
            key={name}
            onClick={() => setSelectedBucket(name)}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              selectedBucket === name ? "bg-wa-dark text-white border-wa-dark" : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {name} ({count})
          </button>
        ))}
      </div>

      <div className="mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name..."
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-xs"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">City</th>
              <th className="px-4 py-2.5 font-medium">{classificationLabel}</th>
              <th className="px-4 py-2.5 font-medium">Owner</th>
              <th className="px-4 py-2.5 font-medium text-right">Contacts</th>
              <th className="px-4 py-2.5 font-medium text-right">Deals</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link href={`/crm/companies/${c.id}`} className="font-medium text-wa-dark hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{c.city ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-600">{classificationValue(c)}</td>
                <td className="px-4 py-2.5 text-slate-600">{c.ownerName ?? "—"}</td>
                <td className="px-4 py-2.5 text-right text-slate-600">{c.contactCount}</td>
                <td className="px-4 py-2.5 text-right text-slate-600">{c.dealCount}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No records in this segment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewCompanyModal
          customerProfiles={customerProfiles}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            toast.success("Organization created");
            router.push(`/crm/companies/${id}`);
          }}
        />
      )}
    </div>
  );
}

function NewCompanyModal({
  customerProfiles,
  onClose,
  onCreated,
}: {
  customerProfiles: Option[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [customerProfileId, setCustomerProfileId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; city: string | null } | null>(null);

  async function submit(e: FormEvent, confirmDuplicate = false) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setDuplicate(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        city: city.trim() || undefined,
        customerProfileId: customerProfileId || undefined,
        confirmDuplicate,
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.account.id);
      return;
    }
    if (res.status === 409) {
      const data = await res.json();
      setDuplicate(data.candidate);
      return;
    }
    toast.error("Could not create company");
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-5">
        <h2 className="font-semibold text-slate-900 mb-4">New organization</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Segment</label>
            <select
              value={customerProfileId}
              onChange={(e) => setCustomerProfileId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Unspecified</option>
              {customerProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {duplicate && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
              Possible duplicate: <strong>{duplicate.name}</strong>
              {duplicate.city ? ` (${duplicate.city})` : ""} already exists.
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={(e) => submit(e as unknown as FormEvent, true)}
                  className="text-xs font-medium bg-amber-600 text-white px-2.5 py-1 rounded"
                >
                  Create anyway
                </button>
                <Link
                  href={`/crm/companies/${duplicate.id}`}
                  className="text-xs font-medium text-amber-800 underline px-2.5 py-1"
                >
                  View existing
                </Link>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
