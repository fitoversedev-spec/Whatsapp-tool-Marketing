"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import type { Rep } from "@/components/meta/MoveToCrmDialog";
import type { MetaLeadLabelChip } from "@/lib/meta-ads/queries";
import type { MetaLeadStageRow } from "@/lib/meta-ads/lead-fields";
import type { WebsiteLeadDetail, WebsiteLeadRow } from "@/lib/website-leads/list";
import LeadManagement from "./LeadManagement";
import { LeadFacts, useLeadActions } from "./LeadDetailParts";

// The right-hand side panel on the Website leads list (like the ad leads panel):
// one lead's key details, the Lead management card and its actions, so a rep can
// work a lead without leaving the list. It loads the lead itself and is shown with
// a `key` of the lead, so another lead is a fresh panel. The list hears about
// changes through the on... callbacks and updates the lead's row.

type PanelBodyProps = {
  reps: Rep[];
  labelCatalog: MetaLeadLabelChip[];
  stageCatalog: MetaLeadStageRow[];
  currentUserId: string;
  isAdmin: boolean;
  canRemove: boolean; // admins and managers
  onRowChange: (id: string, patch: Partial<WebsiteLeadRow>) => void;
  onLabelCreated: (label: MetaLeadLabelChip) => void;
  onLeadGone: (id: string) => void; // removed, restored or deleted: it leaves this view
};

export default function WebsiteLeadPanel({
  leadId,
  listName,
  onClose,
  ...rest
}: PanelBodyProps & { leadId: string; listName: string; onClose: () => void }) {
  const toast = useToast();
  const [lead, setLead] = useState<WebsiteLeadDetail | null>(null);

  // The lead's full detail: when the panel opens, and again after Move to CRM / marketing.
  async function load(signal?: AbortSignal): Promise<WebsiteLeadDetail | null> {
    try {
      const res = await fetch(`/api/website-leads/${leadId}`, { signal });
      if (!res.ok) return null;
      const d: WebsiteLeadDetail = await res.json();
      setLead(d);
      return d;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal).then((d) => {
      if (d || ctrl.signal.aborted) return;
      toast.error("Could not load lead details");
      onClose();
    });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // The new flags and duplicate badges go to the lead's row too.
  async function reload() {
    const d = await load();
    if (!d) {
      toast.error("Could not refresh this lead");
      return;
    }
    rest.onRowChange(d.id, { inCrm: d.inCrm, inMarketing: d.inMarketing, badges: d.badges });
  }

  // Escape closes the panel, unless a dialog open on top of it takes the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop for phones and tablets — click to close */}
      <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={onClose} />
      <aside
        aria-label="Lead details"
        data-hides-assist
        className="fixed top-0 right-0 h-screen supports-[height:100dvh]:h-dvh w-[400px] max-w-[90vw] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 z-50 flex flex-col shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">{lead?.name ?? listName}</h3>
          <div className="flex items-center gap-2 shrink-0">
            <Link href={`/website-leads/${leadId}`} className="text-xs text-court-600 hover:text-court-700 font-medium">
              Full page
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100"
              aria-label="Close panel"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4">
          {lead ? (
            <PanelBody lead={lead} onReload={() => void reload()} {...rest} />
          ) : (
            <div className="flex items-center justify-center py-16">
              <div className="text-sm text-slate-400">Loading…</div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function PanelBody({
  lead,
  reps,
  labelCatalog,
  stageCatalog,
  currentUserId,
  isAdmin,
  canRemove,
  onReload,
  onRowChange,
  onLabelCreated,
  onLeadGone,
}: PanelBodyProps & { lead: WebsiteLeadDetail; onReload: () => void }) {
  const actions = useLeadActions({
    lead,
    reps,
    canRemove,
    isAdmin,
    onChanged: (change) => {
      if (change === "crm" || change === "marketing" || change === "refresh") onReload();
      else onLeadGone(lead.id);
    },
  });

  return (
    <div className="space-y-4">
      {actions.banner}
      <LeadFacts lead={lead} compact />
      <LeadManagement
        lead={lead}
        reps={reps}
        labelCatalog={labelCatalog}
        stageCatalog={stageCatalog}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        onStageSaved={(stage) => onRowChange(lead.id, { stage })}
        onAssigneeSaved={(userId) =>
          onRowChange(lead.id, {
            assignedToUserId: userId,
            assignedToName: reps.find((r) => r.id === userId)?.name ?? null,
          })
        }
        onLabelsSaved={(labels) => onRowChange(lead.id, { labels })}
        onLabelCreated={onLabelCreated}
      />
      {actions.buttons}
      {actions.dialogs}
    </div>
  );
}
