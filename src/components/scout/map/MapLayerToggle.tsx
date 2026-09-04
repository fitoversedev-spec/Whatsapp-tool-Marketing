"use client";

export type MapMode = "2d" | "satellite";

interface Props {
  mode: MapMode;
  onChange: (mode: MapMode) => void;
  disabled?: boolean;
}

export function MapLayerToggle({ mode, onChange, disabled }: Props) {
  return (
    <div className="inline-flex rounded-lg shadow-md text-xs font-medium overflow-hidden">
      <button
        type="button"
        className={`px-3 py-1.5 transition-colors ${
          mode === "2d"
            ? "bg-slate-800 text-white"
            : "bg-white/90 text-slate-700 hover:bg-white"
        }`}
        onClick={() => onChange("2d")}
        disabled={disabled}
      >
        2D
      </button>
      <button
        type="button"
        className={`px-3 py-1.5 transition-colors ${
          mode === "satellite"
            ? "bg-slate-800 text-white"
            : "bg-white/90 text-slate-700 hover:bg-white"
        }`}
        onClick={() => onChange("satellite")}
        disabled={disabled}
      >
        Satellite
      </button>
    </div>
  );
}
