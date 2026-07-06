"use client";

// Right-side properties panel rendered when an element is selected in the
// canvas. Dynamically shows fields per element type — color picker for
// styled shapes, dimension inputs for sized shapes, text + size for
// annotations, etc. Every change calls onUpdate with a partial patch that
// the parent merges into the layout JSON.

import type {
  Element,
  AnnotationElement,
  CricketPitchElement,
  CustomLineElement,
  CustomRectElement,
  FootballFieldElement,
  GoalPostElement,
  BasketballCourtElement,
  PickleballCourtElement,
  NetElement,
  GenericCourtElement,
  FenceRectElement,
  DugoutElement,
  BasketballHoopElement,
  HighlightZoneElement,
} from "@/lib/court-image/schema";

type Props = {
  element: Element;
  onUpdate: (patch: Partial<Element>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveZ: (direction: -1 | 1) => void;
};

export default function ElementInspector({
  element,
  onUpdate,
  onDelete,
  onDuplicate,
  onMoveZ,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">
            Selected
          </div>
          <div className="text-sm font-semibold text-slate-900">
            {labelFor(element)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMoveZ(-1)}
            className="p-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
            title="Send backward"
          >
            ⬇
          </button>
          <button
            type="button"
            onClick={() => onMoveZ(1)}
            className="p-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
            title="Bring forward"
          >
            ⬆
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="p-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
            title="Duplicate"
          >
            ⎘
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-xs text-red-600 hover:bg-red-50 rounded"
            title="Delete"
          >
            🗑
          </button>
        </div>
      </div>

      <Section label="Position">
        <div className="grid grid-cols-3 gap-2">
          <NumberInput
            label="X (ft)"
            value={element.x}
            onChange={(v) => onUpdate({ x: v })}
          />
          <NumberInput
            label="Y (ft)"
            value={element.y}
            onChange={(v) => onUpdate({ y: v })}
          />
          <NumberInput
            label="Rotate °"
            value={element.rotation}
            onChange={(v) => onUpdate({ rotation: v })}
            step={5}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-600">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={!!element.locked}
              onChange={(e) => onUpdate({ locked: e.target.checked })}
            />
            Locked
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={element.visible !== false}
              onChange={(e) => onUpdate({ visible: e.target.checked })}
            />
            Visible
          </label>
        </div>
      </Section>

      {/* Per-type fields */}
      {element.type === "football-field" && (
        <FootballFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "cricket-pitch" && (
        <CricketFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "basketball-court" && (
        <BasketballFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "pickleball-court" && (
        <PickleballFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "generic-court" && (
        <GenericCourtFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "goal-post" && (
        <GoalPostFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "net" && <NetFields element={element} onUpdate={onUpdate} />}
      {element.type === "annotation" && (
        <AnnotationFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "custom-line" && (
        <CustomLineFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "custom-rect" && (
        <CustomRectFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "fence-rect" && (
        <FenceRectFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "dugout" && (
        <DugoutFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "basketball-hoop" && (
        <BasketballHoopFields element={element} onUpdate={onUpdate} />
      )}
      {element.type === "highlight-zone" && (
        <HighlightZoneFields element={element} onUpdate={onUpdate} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Per-type field groups
// ─────────────────────────────────────────────────────────────────────

function FootballFields({
  element,
  onUpdate,
}: {
  element: FootballFieldElement;
  onUpdate: (p: Partial<FootballFieldElement>) => void;
}) {
  return (
    <>
      <Section label="Field size">
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Length (ft)"
            value={element.width}
            onChange={(v) => onUpdate({ width: v })}
          />
          <NumberInput
            label="Width (ft)"
            value={element.height}
            onChange={(v) => onUpdate({ height: v })}
          />
        </div>
        <div>
          <Label>A-side preset</Label>
          <select
            value={element.aSide}
            onChange={(e) =>
              onUpdate({ aSide: parseInt(e.target.value) as 5 | 7 | 11 })
            }
            className={selectClass}
          >
            <option value={5}>5-a-side</option>
            <option value={7}>7-a-side</option>
            <option value={11}>11-a-side</option>
          </select>
        </div>
      </Section>
      <Section label="Colors">
        <ColorInput
          label="Grass"
          value={element.grassColor ?? "#2f8c3e"}
          onChange={(v) => onUpdate({ grassColor: v })}
        />
        <ColorInput
          label="Lines"
          value={element.lineColor ?? "#ffffff"}
          onChange={(v) => onUpdate({ lineColor: v })}
        />
      </Section>
    </>
  );
}

function CricketFields({
  element,
  onUpdate,
}: {
  element: CricketPitchElement;
  onUpdate: (p: Partial<CricketPitchElement>) => void;
}) {
  return (
    <>
      <Section label="Pitch size">
        <div>
          <Label>Length</Label>
          <div className="flex gap-1">
            {[
              { label: "22 yd", v: 66 },
              { label: "12 yd", v: 36 },
              { label: "16 yd", v: 48 },
            ].map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => onUpdate({ pitchLengthFt: opt.v })}
                className={`flex-1 text-xs py-1.5 rounded border ${
                  element.pitchLengthFt === opt.v
                    ? "border-wa-green bg-wa-green/10 text-wa-dark"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Length (ft)"
            value={element.pitchLengthFt}
            onChange={(v) => onUpdate({ pitchLengthFt: v })}
          />
          <NumberInput
            label="Width (ft)"
            value={element.pitchWidthFt}
            onChange={(v) => onUpdate({ pitchWidthFt: v })}
          />
        </div>
      </Section>
      <Section label="Colors">
        <ColorInput
          label="Pitch"
          value={element.pitchColor ?? "#b1683a"}
          onChange={(v) => onUpdate({ pitchColor: v })}
        />
        <ColorInput
          label="Markings"
          value={element.markingColor ?? "#fff5e6"}
          onChange={(v) => onUpdate({ markingColor: v })}
        />
      </Section>
    </>
  );
}

function BasketballFields({
  element,
  onUpdate,
}: {
  element: BasketballCourtElement;
  onUpdate: (p: Partial<BasketballCourtElement>) => void;
}) {
  return (
    <>
      <Section label="Court size">
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Length (ft)"
            value={element.width}
            onChange={(v) => onUpdate({ width: v })}
          />
          <NumberInput
            label="Width (ft)"
            value={element.height}
            onChange={(v) => onUpdate({ height: v })}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={element.halfCourt}
            onChange={(e) => onUpdate({ halfCourt: e.target.checked })}
          />
          Half-court only
        </label>
      </Section>
      <Section label="Colors">
        <ColorInput
          label="Surface"
          value={element.surfaceColor ?? "#c97a4b"}
          onChange={(v) => onUpdate({ surfaceColor: v })}
        />
        <ColorInput
          label="Lines"
          value={element.lineColor ?? "#fff5e6"}
          onChange={(v) => onUpdate({ lineColor: v })}
        />
      </Section>
    </>
  );
}

function PickleballFields({
  element,
  onUpdate,
}: {
  element: PickleballCourtElement;
  onUpdate: (p: Partial<PickleballCourtElement>) => void;
}) {
  return (
    <>
      <Section label="Court size">
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Length (ft)"
            value={element.width}
            onChange={(v) => onUpdate({ width: v })}
          />
          <NumberInput
            label="Width (ft)"
            value={element.height}
            onChange={(v) => onUpdate({ height: v })}
          />
        </div>
      </Section>
      <Section label="Colors">
        <ColorInput
          label="Surface"
          value={element.surfaceColor ?? "#3e7fb7"}
          onChange={(v) => onUpdate({ surfaceColor: v })}
        />
        <ColorInput
          label="Lines"
          value={element.lineColor ?? "#ffffff"}
          onChange={(v) => onUpdate({ lineColor: v })}
        />
      </Section>
    </>
  );
}

function GenericCourtFields({
  element,
  onUpdate,
}: {
  element: GenericCourtElement;
  onUpdate: (p: Partial<GenericCourtElement>) => void;
}) {
  return (
    <Section label="Size & color">
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          label="Length (ft)"
          value={element.width}
          onChange={(v) => onUpdate({ width: v })}
        />
        <NumberInput
          label="Width (ft)"
          value={element.height}
          onChange={(v) => onUpdate({ height: v })}
        />
      </div>
      <ColorInput
        label="Surface"
        value={element.surfaceColor ?? "#5a8a6c"}
        onChange={(v) => onUpdate({ surfaceColor: v })}
      />
      <ColorInput
        label="Lines"
        value={element.lineColor ?? "#ffffff"}
        onChange={(v) => onUpdate({ lineColor: v })}
      />
    </Section>
  );
}

function GoalPostFields({
  element,
  onUpdate,
}: {
  element: GoalPostElement;
  onUpdate: (p: Partial<GoalPostElement>) => void;
}) {
  return (
    <Section label="Goal size">
      <div className="grid grid-cols-3 gap-2">
        <NumberInput
          label="Width (ft)"
          value={element.widthFt}
          onChange={(v) => onUpdate({ widthFt: v })}
        />
        <NumberInput
          label="Height (ft)"
          value={element.heightFt}
          onChange={(v) => onUpdate({ heightFt: v })}
        />
        <NumberInput
          label="Depth (ft)"
          value={element.depthFt}
          onChange={(v) => onUpdate({ depthFt: v })}
        />
      </div>
    </Section>
  );
}

function NetFields({
  element,
  onUpdate,
}: {
  element: NetElement;
  onUpdate: (p: Partial<NetElement>) => void;
}) {
  return (
    <Section label="Net">
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          label="Width (ft)"
          value={element.widthFt}
          onChange={(v) => onUpdate({ widthFt: v })}
        />
        <NumberInput
          label="Height (ft)"
          value={element.heightFt}
          onChange={(v) => onUpdate({ heightFt: v })}
        />
      </div>
    </Section>
  );
}

function AnnotationFields({
  element,
  onUpdate,
}: {
  element: AnnotationElement;
  onUpdate: (p: Partial<AnnotationElement>) => void;
}) {
  return (
    <>
      <Section label="Text">
        <textarea
          value={element.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          rows={2}
          className={inputClass + " resize-none"}
        />
        <NumberInput
          label="Font size (ft)"
          value={element.fontSize}
          onChange={(v) => onUpdate({ fontSize: v })}
          step={0.5}
        />
        <div>
          <Label>Align</Label>
          <div className="flex gap-1">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => onUpdate({ align: a })}
                className={`flex-1 text-xs py-1.5 rounded border ${
                  (element.align ?? "center") === a
                    ? "border-wa-green bg-wa-green/10 text-wa-dark"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </Section>
      <Section label="Color">
        <ColorInput
          label="Text"
          value={element.color ?? "#0f172a"}
          onChange={(v) => onUpdate({ color: v })}
        />
        <ColorInput
          label="Background"
          value={element.background ?? "rgba(255,255,255,0.85)"}
          onChange={(v) => onUpdate({ background: v })}
        />
      </Section>
    </>
  );
}

function CustomLineFields({
  element,
  onUpdate,
}: {
  element: CustomLineElement;
  onUpdate: (p: Partial<CustomLineElement>) => void;
}) {
  return (
    <Section label="Line">
      <NumberInput
        label="Length (ft)"
        value={element.lengthFt}
        onChange={(v) => onUpdate({ lengthFt: v })}
      />
      <NumberInput
        label="Thickness (px)"
        value={element.thickness}
        onChange={(v) => onUpdate({ thickness: v })}
        step={1}
      />
      <ColorInput
        label="Color"
        value={element.color ?? "#0f172a"}
        onChange={(v) => onUpdate({ color: v })}
      />
      <div>
        <Label>Arrow head</Label>
        <div className="flex gap-1">
          {(["none", "end", "both"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onUpdate({ arrow: a })}
              className={`flex-1 text-xs py-1.5 rounded border ${
                (element.arrow ?? "none") === a
                  ? "border-wa-green bg-wa-green/10 text-wa-dark"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={!!element.dashed}
          onChange={(e) => onUpdate({ dashed: e.target.checked })}
        />
        Dashed
      </label>
    </Section>
  );
}

function CustomRectFields({
  element,
  onUpdate,
}: {
  element: CustomRectElement;
  onUpdate: (p: Partial<CustomRectElement>) => void;
}) {
  return (
    <>
      <Section label="Rectangle">
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Width (ft)"
            value={element.width}
            onChange={(v) => onUpdate({ width: v })}
          />
          <NumberInput
            label="Height (ft)"
            value={element.height}
            onChange={(v) => onUpdate({ height: v })}
          />
        </div>
      </Section>
      <Section label="Colors">
        <ColorInput
          label="Fill"
          value={element.fill ?? "rgba(15,23,42,0.08)"}
          onChange={(v) => onUpdate({ fill: v })}
        />
        <ColorInput
          label="Border"
          value={element.stroke ?? "#0f172a"}
          onChange={(v) => onUpdate({ stroke: v })}
        />
      </Section>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Small UI helpers
// ─────────────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
        {label}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
      {children}
    </div>
  );
}

const inputClass =
  "w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30";

const selectClass = inputClass + " bg-white";

function NumberInput({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className={inputClass + " text-right"}
      />
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  // Strip rgba for the native picker (which only handles #rrggbb) but
  // pass through the original value otherwise so users can keep alpha.
  const hexValue = toHexish(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hexValue}
        onChange={(e) => onChange(e.target.value)}
        className="w-9 h-9 rounded border border-slate-300 cursor-pointer p-0.5"
      />
      <div className="flex-1">
        <Label>{label}</Label>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass + " text-xs font-mono"}
        />
      </div>
    </div>
  );
}

function toHexish(v: string): string {
  if (v.startsWith("#")) return v.length === 7 ? v : "#" + v.slice(1).padEnd(6, "0");
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return "#000000";
  const parts = m[1].split(",").map((p) => parseInt(p.trim()));
  const [r, g, b] = parts;
  return (
    "#" +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0"))
      .join("")
  );
}

function labelFor(el: Element): string {
  switch (el.type) {
    case "football-field":
      return `Football field (${el.aSide}-a-side)`;
    case "cricket-pitch":
      return "Cricket pitch";
    case "basketball-court":
      return el.halfCourt ? "Basketball half-court" : "Basketball court";
    case "pickleball-court":
      return "Pickleball court";
    case "generic-court":
      return el.sport.charAt(0).toUpperCase() + el.sport.slice(1) + " court";
    case "goal-post":
      return "Goal post";
    case "net":
      return "Net";
    case "annotation":
      return `Label · "${el.text.slice(0, 20)}${el.text.length > 20 ? "…" : ""}"`;
    case "custom-line":
      return "Line";
    case "custom-rect":
      return "Rectangle";
    case "fence-rect":
      return "Fence";
    case "dugout":
      return "Dugout";
    case "basketball-hoop":
      return "Basketball hoop";
    case "highlight-zone":
      return "Highlight zone";
  }
}

function HighlightZoneFields({
  element,
  onUpdate,
}: {
  element: HighlightZoneElement;
  onUpdate: (p: Partial<HighlightZoneElement>) => void;
}) {
  // Split "rgba(r, g, b, a)" into RGB hex + alpha slider so sales can
  // tweak both independently. Falls back to solid amber if the stored
  // value isn't in the expected shape (shouldn't happen from our
  // factory but be forgiving on re-open of hand-edited layouts).
  const parsed = parseRgba(element.fill);
  const hex = parsed
    ? rgbToHex(parsed.r, parsed.g, parsed.b)
    : "#ffc107";
  const alpha = parsed ? parsed.a : 0.45;
  return (
    <>
      <Section label="Zone size">
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Width (ft)"
            value={element.width}
            onChange={(v) => onUpdate({ width: v })}
          />
          <NumberInput
            label="Height (ft)"
            value={element.height}
            onChange={(v) => onUpdate({ height: v })}
          />
        </div>
      </Section>
      <Section label="Fill">
        <ColorInput
          label="Colour"
          value={hex}
          onChange={(v) => {
            const rgb = hexToRgb(v);
            if (rgb) {
              onUpdate({
                fill: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`,
              });
            }
          }}
        />
        <div>
          <Label>Opacity ({Math.round(alpha * 100)}%)</Label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(alpha * 100)}
            onChange={(e) => {
              const a = parseInt(e.target.value) / 100;
              const rgb = hexToRgb(hex);
              if (rgb) {
                onUpdate({ fill: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})` });
              }
            }}
            className="w-full"
          />
        </div>
      </Section>
    </>
  );
}

// Helpers used only by HighlightZoneFields. Kept local so they don't
// leak into unrelated code paths.
function parseRgba(input: string): { r: number; g: number; b: number; a: number } | null {
  const m = input.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  if (!m) return null;
  return {
    r: parseInt(m[1]),
    g: parseInt(m[2]),
    b: parseInt(m[3]),
    a: m[4] ? parseFloat(m[4]) : 1,
  };
}
function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#?([a-f\d]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function FenceRectFields({
  element,
  onUpdate,
}: {
  element: FenceRectElement;
  onUpdate: (p: Partial<FenceRectElement>) => void;
}) {
  return (
    <>
      <Section label="Fence size">
        <div className="grid grid-cols-3 gap-2">
          <NumberInput
            label="Length (ft)"
            value={element.width}
            onChange={(v) => onUpdate({ width: v })}
          />
          <NumberInput
            label="Width (ft)"
            value={element.height}
            onChange={(v) => onUpdate({ height: v })}
          />
          <NumberInput
            label="Height (ft)"
            value={element.heightFt}
            onChange={(v) => onUpdate({ heightFt: v })}
          />
        </div>
        <ColorInput
          label="Color"
          value={element.color ?? "#94a3b8"}
          onChange={(v) => onUpdate({ color: v })}
        />
      </Section>
      <Section label="Gate">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={!!element.hasGate}
            onChange={(e) => onUpdate({ hasGate: e.target.checked })}
          />
          Has gate / opening
        </label>
        {element.hasGate && (
          <div>
            <Label>Gate side</Label>
            <div className="grid grid-cols-4 gap-1">
              {(["north", "south", "east", "west"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onUpdate({ gateEdge: s })}
                  className={`px-2 py-1 text-xs rounded border capitalize ${
                    element.gateEdge === s
                      ? "border-wa-green bg-wa-green/10 text-wa-dark"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

function DugoutFields({
  element,
  onUpdate,
}: {
  element: DugoutElement;
  onUpdate: (p: Partial<DugoutElement>) => void;
}) {
  return (
    <>
      <Section label="Dugout size">
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Length (ft)"
            value={element.width}
            onChange={(v) => onUpdate({ width: v })}
          />
          <NumberInput
            label="Depth (ft)"
            value={element.height}
            onChange={(v) => onUpdate({ height: v })}
          />
        </div>
        <div>
          <Label>Open side (faces field)</Label>
          <div className="grid grid-cols-4 gap-1">
            {(["north", "south", "east", "west"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onUpdate({ openSide: s })}
                className={`px-2 py-1 text-xs rounded border capitalize ${
                  element.openSide === s
                    ? "border-wa-green bg-wa-green/10 text-wa-dark"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </Section>
      <Section label="Colors">
        <ColorInput
          label="Roof"
          value={element.roofColor ?? "#475569"}
          onChange={(v) => onUpdate({ roofColor: v })}
        />
        <ColorInput
          label="Bench"
          value={element.benchColor ?? "#cbd5e1"}
          onChange={(v) => onUpdate({ benchColor: v })}
        />
      </Section>
    </>
  );
}

function BasketballHoopFields({
  element,
  onUpdate,
}: {
  element: BasketballHoopElement;
  onUpdate: (p: Partial<BasketballHoopElement>) => void;
}) {
  return (
    <>
      <Section label="Hoop">
        <NumberInput
          label="Pole height (ft)"
          value={element.poleHeightFt}
          onChange={(v) => onUpdate({ poleHeightFt: v })}
        />
        <NumberInput
          label="Backboard width (ft)"
          value={element.backboardWidthFt}
          onChange={(v) => onUpdate({ backboardWidthFt: v })}
        />
      </Section>
      <Section label="Colors">
        <ColorInput
          label="Pole / backboard"
          value={element.color ?? "#0f172a"}
          onChange={(v) => onUpdate({ color: v })}
        />
        <ColorInput
          label="Rim"
          value={element.rimColor ?? "#ef4444"}
          onChange={(v) => onUpdate({ rimColor: v })}
        />
      </Section>
    </>
  );
}
