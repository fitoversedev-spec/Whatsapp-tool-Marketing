"use client";

import { useCallback, useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/scout/forms/SubmitButton";
import {
  updateWeightsAction,
  activateModelAction,
  type ScoringActionState,
} from "./actions";
import type { ScoreModelWeights } from "@/lib/scout/scoring";

/* ------------------------------------------------------------------ types */

interface ComponentWeights {
  demandAnchors: number;
  competitiveSaturation: number;
  marketProof: number;
  serviceGap: number;
  sitePracticals: number;
}

interface VersionRow {
  id: string;
  version: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

interface WeightsEditorProps {
  weights: ScoreModelWeights;
  currentVersion: string;
  versions: VersionRow[];
}

/* ------------------------------------------------- component descriptors */

const COMPONENT_META: Array<{
  key: keyof ComponentWeights;
  label: string;
  description: string;
}> = [
  {
    key: "demandAnchors",
    label: "Demand Anchors",
    description:
      "Weighted presence of demand-generating places (offices, colleges, apartments) within the scan radius. Higher weight = demand evidence matters more.",
  },
  {
    key: "competitiveSaturation",
    label: "Competitive Saturation",
    description:
      "How crowded the market is relative to demand. Fewer competitors per anchor = higher score. Benchmarked against the city median.",
  },
  {
    key: "marketProof",
    label: "Market Proof",
    description:
      "Google review volume across competitors. More reviews = proven, active market. Split between total reviews and per-facility depth.",
  },
  {
    key: "serviceGap",
    label: "Service Gap",
    description:
      "Quality and breadth gaps in the existing supply: rating gaps, format concentration, unserved sports, and complaint themes.",
  },
  {
    key: "sitePracticals",
    label: "Site Practicals",
    description:
      "Physical site conditions from the surveyor checklist: road access, parking, utilities, drainage, flood risk, boundary, noise restrictions.",
  },
];

/* ------------------------------------------------------- sub-components */

interface SliderRowProps {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}

function SliderRow({ label, description, value, onChange, disabled }: SliderRowProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-center justify-between gap-4 mb-2">
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-slate-900">{label}</h4>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            disabled={disabled}
            className="w-16 rounded-md border border-slate-300 px-2 py-1 text-center text-sm font-mono font-semibold text-slate-900 focus:border-court-500 focus:outline-none focus:ring-1 focus:ring-court-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <span className="text-xs text-slate-400 font-medium">pts</span>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-court-500 disabled:accent-slate-300 disabled:cursor-not-allowed"
      />
    </div>
  );
}

/* ----------------------------------------------------------------- main */

const INITIAL: ScoringActionState = {};

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function WeightsEditor({ weights, currentVersion, versions }: WeightsEditorProps) {
  const [editing, setEditing] = useState(false);
  const [components, setComponents] = useState<ComponentWeights>({ ...weights.components });
  const [saveState, saveAction] = useFormState(updateWeightsAction, INITIAL);
  const [activateState, activateAction] = useFormState(activateModelAction, INITIAL);

  const total = Object.values(components).reduce((s, v) => s + v, 0);
  const isValid = Math.abs(total - 100) < 0.001;
  const hasChanges = Object.keys(weights.components).some(
    (k) => components[k as keyof ComponentWeights] !== weights.components[k as keyof ComponentWeights],
  );

  const updateComponent = useCallback(
    (key: keyof ComponentWeights, value: number) => {
      setComponents((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetToActive = useCallback(() => {
    setComponents({ ...weights.components });
  }, [weights.components]);

  const cancelEdit = useCallback(() => {
    resetToActive();
    setEditing(false);
  }, [resetToActive]);

  // Build the full weights payload to send to the server action.
  // We carry forward the non-component weights (anchors, saturation sub-params, etc.)
  // from the current active model and only override the component allocation.
  // Sub-component point allocations for marketProof and serviceGap must match
  // the new component totals — we scale them proportionally.
  const buildPayload = useCallback(() => {
    const mpOld = weights.components.marketProof;
    const mpNew = components.marketProof;
    const mpScale = mpOld > 0 ? mpNew / mpOld : 1;

    const sgOld = weights.components.serviceGap;
    const sgNew = components.serviceGap;
    const sgScale = sgOld > 0 ? sgNew / sgOld : 1;

    return JSON.stringify({
      components,
      marketProof: {
        totalReviewsPoints: Math.round(weights.marketProof.totalReviewsPoints * mpScale * 100) / 100,
        perFacilityPoints: Math.round((mpNew - Math.round(weights.marketProof.totalReviewsPoints * mpScale * 100) / 100) * 100) / 100,
      },
      serviceGap: {
        ratingGapPoints: Math.round(weights.serviceGap.ratingGapPoints * sgScale * 100) / 100,
        concentrationPoints: Math.round(weights.serviceGap.concentrationPoints * sgScale * 100) / 100,
        unservedSportsPoints: Math.round(weights.serviceGap.unservedSportsPoints * sgScale * 100) / 100,
        complaintThemePoints: Math.round(
          (sgNew -
            Math.round(weights.serviceGap.ratingGapPoints * sgScale * 100) / 100 -
            Math.round(weights.serviceGap.concentrationPoints * sgScale * 100) / 100 -
            Math.round(weights.serviceGap.unservedSportsPoints * sgScale * 100) / 100) * 100,
        ) / 100,
      },
    });
  }, [components, weights]);

  return (
    <div className="space-y-8">
      {/* ── Status banner ───────────────────────────────────── */}
      {(saveState.message || saveState.error || activateState.message || activateState.error) && (
        <div
          role={saveState.error || activateState.error ? "alert" : "status"}
          className={`rounded-lg px-4 py-3 text-sm font-medium ${
            saveState.error || activateState.error
              ? "bg-track-50 text-track-700 border border-track-200"
              : "bg-turf-50 text-turf-700 border border-turf-200"
          }`}
        >
          {saveState.message || saveState.error || activateState.message || activateState.error}
        </div>
      )}

      {/* ── Active model header ─────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Component Weights</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Active model: <span className="font-mono font-semibold text-slate-700">v{currentVersion}</span>
            {" "}&mdash; points must total 100
          </p>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg bg-court-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-court-600 transition-colors"
          >
            Edit Weights
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={resetToActive}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* ── Weight sliders ──────────────────────────────────── */}
      <div className="space-y-3">
        {COMPONENT_META.map((meta) => (
          <SliderRow
            key={meta.key}
            label={meta.label}
            description={meta.description}
            value={components[meta.key]}
            onChange={(v) => updateComponent(meta.key, v)}
            disabled={!editing}
          />
        ))}
      </div>

      {/* ── Total indicator ─────────────────────────────────── */}
      <div className={`flex items-center justify-between rounded-lg px-4 py-3 font-mono text-sm font-semibold ${
        isValid
          ? "bg-turf-50 text-turf-700 border border-turf-200"
          : "bg-track-50 text-track-700 border border-track-200"
      }`}>
        <span>Total</span>
        <span>{total} / 100{!isValid && ` (${total > 100 ? "+" : ""}${total - 100})`}</span>
      </div>

      {/* ── Save form ───────────────────────────────────────── */}
      {editing && (
        <form action={saveAction}>
          <input type="hidden" name="weights" value={buildPayload()} />
          <SubmitButton
            disabled={!isValid || !hasChanges}
            pendingLabel="Saving..."
          >
            Save as New Version
          </SubmitButton>
        </form>
      )}

      {/* ── Version history ─────────────────────────────────── */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Version History</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {versions.map((v) => (
                <tr key={v.id} className={v.isActive ? "bg-turf-50/40" : ""}>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-800">{v.version}</td>
                  <td className="px-4 py-3 text-slate-600 truncate max-w-[240px]">{v.name}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{dateFmt.format(new Date(v.createdAt))}</td>
                  <td className="px-4 py-3">
                    {v.isActive ? (
                      <span className="inline-flex items-center rounded-full bg-turf-100 px-2 py-0.5 text-xs font-semibold text-turf-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!v.isActive && (
                      <form action={activateAction} className="inline">
                        <input type="hidden" name="modelId" value={v.id} />
                        <SubmitButton size="sm" variant="secondary" pendingLabel="Activating...">
                          Activate
                        </SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
