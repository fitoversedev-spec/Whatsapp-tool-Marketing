"use client";

export type MapMode = "2d" | "satellite";

interface Props {
  mode: MapMode;
  onChange: (mode: MapMode) => void;
  disabled?: boolean;
}

export function MapLayerToggle({ mode, onChange, disabled }: Props) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-slate-300 shadow-md bg-white text-xs font-medium">
      <button
        type="button"
        className={`px-3 py-1.5 transition-colors ${
          mode === "2d"
            ? "bg-slate-800 text-white"
            : "bg-white text-slate-600 hover:bg-slate-100"
        }`}
        onClick={() => onChange("2d")}
        disabled={disabled}
      >
        2D
      </button>
      <button
        type="button"
        className={`px-3 py-1.5 transition-colors border-l border-slate-300 ${
          mode === "satellite"
            ? "bg-slate-800 text-white"
            : "bg-white text-slate-600 hover:bg-slate-100"
        }`}
        onClick={() => onChange("satellite")}
        disabled={disabled}
      >
        Satellite
      </button>
    </div>
  );
}
