"use client";

// Bot lead data sheet — sales looks at this daily. Table view with
// filters at the top, click a row to jump to the inbox conversation.
// Status + assignee are inline-editable; export dumps whatever the
// current filter set matches to xlsx.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import * as XLSX from "xlsx";

type Lead = {
  id: string;
  conversationId: string;
  contactPhone: string;
  contactName: string | null;
  path: string;
  location: string | null;
  sizeFt: number | null;
  sport: string | null;
  maintenanceType: string | null;
  productCategory: string | null;
  preferredDateTime: string | null;
  status: string;
  assignedToUserId: string | null;
  notes: string | null;
  createdAt: string;
};

type UserOption = { id: string; name: string; role: string };

type GeneralLead = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  city: string | null;
  status: string;
  sourceName: string | null;
  ownerName: string | null;
  createdAt: string;
};

const GENERAL_STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-800",
  CONTACTED: "bg-purple-100 text-purple-800",
  QUALIFIED: "bg-green-100 text-green-800",
  DISQUALIFIED: "bg-slate-100 text-slate-600",
};

const PATH_LABEL: Record<string, string> = {
  turnkey_new: "Turnkey — New",
  turnkey_maintenance: "Maintenance",
  consultation: "Consultation",
  product: "Product",
  unknown: "Unknown",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  contacted: "bg-purple-100 text-purple-800",
  converted: "bg-green-100 text-green-800",
  lost: "bg-slate-100 text-slate-600",
};

export default function LeadsClient({
  leads,
  generalLeads,
  users,
  currentUserId,
  isAdmin,
}: {
  leads: Lead[];
  generalLeads: GeneralLead[];
  users: UserOption[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [tab, setTab] = useState<"bot" | "general">("bot");
  const [pathFilter, setPathFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [assignedFilter, setAssignedFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (pathFilter !== "all" && l.path !== pathFilter) return false;
      if (statusFilter === "open") {
        if (l.status === "converted" || l.status === "lost") return false;
      } else if (statusFilter !== "all") {
        if (l.status !== statusFilter) return false;
      }
      if (assignedFilter === "mine") {
        if (l.assignedToUserId !== currentUserId) return false;
      } else if (assignedFilter === "unassigned") {
        if (l.assignedToUserId) return false;
      } else if (assignedFilter !== "all") {
        if (l.assignedToUserId !== assignedFilter) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        const blob = [
          l.contactName ?? "",
          l.contactPhone,
          l.location ?? "",
          l.sport ?? "",
          l.maintenanceType ?? "",
          l.productCategory ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(s)) return false;
      }
      return true;
    });
  }, [leads, pathFilter, statusFilter, assignedFilter, search, currentUserId]);

  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const l of leads) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    return byStatus;
  }, [leads]);

  async function patchLead(id: string, patch: Partial<Lead>) {
    const r = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "Update failed");
      return;
    }
    router.refresh();
  }

  function exportXlsx() {
    const rows = filtered.map((l) => ({
      "Created": new Date(l.createdAt).toLocaleString("en-IN"),
      "Name": l.contactName ?? "",
      "Phone": l.contactPhone,
      "Path": PATH_LABEL[l.path] ?? l.path,
      "Location": l.location ?? "",
      "Size (ft)": l.sizeFt ?? "",
      "Sport": l.sport ?? "",
      "Maintenance": l.maintenanceType ?? "",
      "Product": l.productCategory ?? "",
      "Preferred call time": l.preferredDateTime ?? "",
      "Status": l.status,
      "Assigned to":
        users.find((u) => u.id === l.assignedToUserId)?.name ?? "",
      "Notes": l.notes ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `fitoverse-leads-${stamp}.xlsx`);
  }

  const salesUsers = users.filter((u) => u.role === "sales");
  const adminUsers = users.filter((u) => u.role === "admin");

  return (
    <>
      <PageHeader
        title="Bot leads"
        description={`${leads.length} total captured from the WhatsApp chatbot · ${
          stats.new ?? 0
        } new · ${stats.in_progress ?? 0} in progress`}
        action={
          <button
            type="button"
            onClick={exportXlsx}
            className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Export xlsx
          </button>
        }
      />

      <div className="px-4 sm:px-6 lg:px-8 pt-4 flex gap-1.5">
        <button
          onClick={() => setTab("bot")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            tab === "bot" ? "bg-wa-green text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          Bot Leads ({leads.length})
        </button>
        <button
          onClick={() => setTab("general")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            tab === "general" ? "bg-wa-green text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          General Leads ({generalLeads.length})
        </button>
      </div>

      {tab === "general" ? (
        <GeneralLeadsTable leads={generalLeads} />
      ) : (
      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-medium text-slate-600 uppercase tracking-wide mb-1">
              Search
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, location…"
              className="input"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 uppercase tracking-wide mb-1">
              Path
            </label>
            <select
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              className="input"
            >
              <option value="all">All</option>
              <option value="turnkey_new">Turnkey — New</option>
              <option value="turnkey_maintenance">Maintenance</option>
              <option value="consultation">Consultation</option>
              <option value="product">Product</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 uppercase tracking-wide mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input"
            >
              <option value="open">Open (new + in progress + contacted)</option>
              <option value="new">New only</option>
              <option value="in_progress">In progress</option>
              <option value="contacted">Contacted</option>
              <option value="converted">Converted</option>
              <option value="lost">Lost</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 uppercase tracking-wide mb-1">
              Assigned
            </label>
            <select
              value={assignedFilter}
              onChange={(e) => setAssignedFilter(e.target.value)}
              className="input"
            >
              <option value="all">All</option>
              <option value="mine">Mine</option>
              <option value="unassigned">Unassigned</option>
              {salesUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
              {isAdmin &&
                adminUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} (admin)
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center text-slate-500 text-sm">
            {leads.length === 0
              ? "No bot leads yet. Once customers complete the WhatsApp chatbot flow, they show up here."
              : "No leads match the current filters."}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-medium tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Created</th>
                    <th className="px-4 py-3 text-left">Contact</th>
                    <th className="px-4 py-3 text-left">Path</th>
                    <th className="px-4 py-3 text-left">Details</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Assigned</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(l.createdAt).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {l.contactName ?? "(no name)"}
                        </div>
                        <div className="text-xs text-slate-500">
                          +{l.contactPhone}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                        {PATH_LABEL[l.path] ?? l.path}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="text-xs space-y-0.5">
                          {l.location && <div>📍 {l.location}</div>}
                          {l.sizeFt && <div>📏 {l.sizeFt} ft</div>}
                          {l.sport && <div>⚽ {l.sport}</div>}
                          {l.maintenanceType && <div>🔧 {l.maintenanceType}</div>}
                          {l.productCategory && <div>📦 {l.productCategory}</div>}
                          {l.preferredDateTime && (
                            <div>📞 {new Date(l.preferredDateTime).toLocaleString("en-IN")}</div>
                          )}
                          {l.notes && (
                            <div className="text-amber-700">⚠ {l.notes}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={l.status}
                          onChange={(e) => patchLead(l.id, { status: e.target.value })}
                          className={`text-xs font-medium px-2 py-1 rounded-md border-0 ${
                            STATUS_COLORS[l.status] ?? "bg-slate-100"
                          }`}
                        >
                          <option value="new">New</option>
                          <option value="in_progress">In progress</option>
                          <option value="contacted">Contacted</option>
                          <option value="converted">Converted</option>
                          <option value="lost">Lost</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={l.assignedToUserId ?? ""}
                          onChange={(e) =>
                            patchLead(l.id, {
                              assignedToUserId: e.target.value || null,
                            } as any)
                          }
                          className="text-xs border border-slate-200 rounded-md px-2 py-1"
                        >
                          <option value="">Unassigned</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`/inbox?conversation=${l.conversationId}`}
                          className="text-xs font-medium text-wa-green hover:underline"
                        >
                          Open chat →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      )}
    </>
  );
}

function GeneralLeadsTable({ leads }: { leads: GeneralLead[] }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {leads.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center text-slate-500 text-sm">
          No general leads yet. These come from manual entry or referrals — see /deals to create one, or via POST /api/leads.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-medium tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-left">Contact</th>
                  <th className="px-4 py-3 text-left">City</th>
                  <th className="px-4 py-3 text-left">Source</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Owner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{l.name}</div>
                      <div className="text-xs text-slate-500">{l.phone}{l.email ? ` · ${l.email}` : ""}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{l.city ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{l.sourceName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-md ${GENERAL_STATUS_COLORS[l.status] ?? "bg-slate-100"}`}>
                        {l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{l.ownerName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
