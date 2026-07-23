"use client";

import { Bar } from "recharts/es6/cartesian/Bar";
import { CartesianGrid } from "recharts/es6/cartesian/CartesianGrid";
import { ReferenceLine } from "recharts/es6/cartesian/ReferenceLine";
import { Scatter } from "recharts/es6/cartesian/Scatter";
import { XAxis } from "recharts/es6/cartesian/XAxis";
import { YAxis } from "recharts/es6/cartesian/YAxis";
import { ZAxis } from "recharts/es6/cartesian/ZAxis";
import { BarChart } from "recharts/es6/chart/BarChart";
import { PieChart } from "recharts/es6/chart/PieChart";
import { ScatterChart } from "recharts/es6/chart/ScatterChart";
import { Pie } from "recharts/es6/polar/Pie";
import { Cell } from "recharts/es6/component/Cell";
import { ResponsiveContainer } from "recharts/es6/component/ResponsiveContainer";
import { Tooltip } from "recharts/es6/component/Tooltip";

export function fmtInr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
export function fmtPct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
export function fmtDays(n: number | null): string {
  return n == null ? "—" : n < 1 ? `${Math.round(n * 24)}h` : `${n.toFixed(1)}d`;
}

// Shared horizontal bar chart for every magnitude-by-category comparison
// across analytics (stage velocity, pipeline by stage, best-selling
// products, platform performance) — thin marks, rounded data-end, recessive
// dashed grid, no axis lines, hover tooltip. One instance per use since each
// binds its own row shape/formatter, but the visual spec stays identical.
export function HorizontalBarChart<T extends Record<string, unknown>>({
  data,
  dataKey,
  labelKey,
  height,
  colorFor,
  tooltipFormatter,
}: {
  data: T[];
  dataKey: keyof T & string;
  labelKey: keyof T & string;
  height: number;
  colorFor: (d: T) => string;
  tooltipFormatter: (d: T) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey={labelKey as any} width={140} tick={{ fontSize: 12, fill: "#334155" }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: "#f8fafc" }}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 2px 8px rgba(15,23,42,0.08)" }}
          formatter={((_value: unknown, _name: string, item: { payload: T }) => [tooltipFormatter(item.payload), ""]) as any}
          labelFormatter={() => ""}
        />
        <Bar dataKey={dataKey as any} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((d, i) => (
            <Cell key={i} fill={colorFor(d)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Vertical stacked bar chart — one <Bar> per stackKeys entry sharing a
// stackId, plain-HTML legend above the chart (colored dot + label) rather
// than Recharts' own <Legend>, matching this codebase's preference for
// plain HTML over library chrome elsewhere (see HorizontalBarChart's
// DataTable pairing).
export function StackedBarChart<T extends Record<string, unknown>>({
  data,
  dataKey,
  stackKeys,
  height,
  colorFor,
  tooltipFormatter,
}: {
  data: T[];
  dataKey: keyof T & string;
  stackKeys: string[];
  height: number;
  colorFor: (stackKey: string) => string;
  tooltipFormatter: (d: T) => string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        {stackKeys.map((k) => (
          <div key={k} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorFor(k) }} />
            {k}
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey={dataKey as any} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "#f8fafc" }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 2px 8px rgba(15,23,42,0.08)" }}
            formatter={((_value: unknown, _name: string, item: { payload: T }) => [tooltipFormatter(item.payload), ""]) as any}
            labelFormatter={() => ""}
          />
          {stackKeys.map((k) => (
            <Bar key={k} dataKey={k} stackId="stack" fill={colorFor(k)} radius={[0, 0, 0, 0]} maxBarSize={40} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Default categorical palette for the donut when a caller has no palette of
// its own — a clean 8-color set that stays legible in adjacent slices.
export const DONUT_PALETTE = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
];

// Donut/pie for share-of-total by category (e.g. "leads by source"). One
// <Cell> per row colored via colorFor, a plain-HTML legend below (colored
// dot + label + value) matching StackedBarChart rather than Recharts'
// <Legend>, and a hover tooltip driven by the caller's tooltipFormatter.
export function DonutChart<T extends Record<string, unknown>>({
  data,
  dataKey,
  labelKey,
  height,
  colorFor,
  tooltipFormatter,
}: {
  data: T[];
  dataKey: keyof T & string; // the numeric value slice
  labelKey: keyof T & string; // the category label
  height?: number;
  colorFor: (row: T, index: number) => string;
  tooltipFormatter?: (row: T) => string;
}) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height ?? 220}>
        <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Tooltip
            cursor={{ fill: "#f8fafc" }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 2px 8px rgba(15,23,42,0.08)" }}
            formatter={((_value: unknown, _name: string, item: { payload: T }) => [tooltipFormatter ? tooltipFormatter(item.payload) : String(item.payload[dataKey]), ""]) as any}
            labelFormatter={() => ""}
          />
          <Pie
            data={data}
            dataKey={dataKey as any}
            nameKey={labelKey as any}
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={1}
            stroke="#ffffff"
            strokeWidth={1}
          >
            {data.map((row, i) => (
              <Cell key={i} fill={colorFor(row, i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-3 mt-2">
        {data.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorFor(row, i) }} />
            {String(row[labelKey])}
            <span className="text-slate-400">{String(row[dataKey])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Two-axis scatter split into four quadrants by xBenchmark/yBenchmark
// threshold lines. Points whose id is in lowConfidenceIds render at reduced
// opacity — the caller's own tooltipFormatter is responsible for appending
// the "n=X, low confidence" text for those points itself; there's no second
// tooltip mechanism here, just the one formatter.
export function QuadrantScatter<T extends Record<string, unknown>>({
  data,
  xKey,
  yKey,
  labelKey,
  height,
  xBenchmark,
  yBenchmark,
  colorFor,
  tooltipFormatter,
  lowConfidenceIds,
}: {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  labelKey: keyof T & string;
  height: number;
  xBenchmark: number;
  yBenchmark: number;
  colorFor: (d: T) => string;
  tooltipFormatter: (d: T) => string;
  lowConfidenceIds?: Set<string>;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" dataKey={xKey as any} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis type="number" dataKey={yKey as any} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <ReferenceLine x={xBenchmark} stroke="#cbd5e1" strokeDasharray="3 3" />
        <ReferenceLine y={yBenchmark} stroke="#cbd5e1" strokeDasharray="3 3" />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 2px 8px rgba(15,23,42,0.08)" }}
          formatter={((_value: unknown, _name: string, item: { payload: T }) => [tooltipFormatter(item.payload), ""]) as any}
          labelFormatter={() => ""}
        />
        <Scatter data={data} dataKey={yKey as any}>
          {data.map((d, i) => {
            const id = String(d[labelKey]);
            const lowConfidence = lowConfidenceIds?.has(id) ?? false;
            return <Cell key={i} fill={colorFor(d)} opacity={lowConfidence ? 0.4 : 1} />;
          })}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// Territory's variable-size bubbles (avg deal size x win rate, radius =
// enquiry volume): QuadrantScatter's own <Scatter> has no z-dimension at
// all — its Cell only ever sets fill/opacity, so reusing it as-is would
// render every city as the same fixed-size dot. Recharts already ships a
// <ZAxis> for exactly this (bubble size from a third numeric field) — no
// custom shape function needed, just one extra axis alongside the existing
// x/y — so this is a second primitive, not a QuadrantScatter variant.
export function BubbleChart<T extends Record<string, unknown>>({
  data,
  xKey,
  yKey,
  zKey,
  labelKey,
  height,
  colorFor,
  tooltipFormatter,
  lowConfidenceIds,
}: {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  zKey: keyof T & string;
  labelKey: keyof T & string;
  height: number;
  colorFor: (d: T) => string;
  tooltipFormatter: (d: T) => string;
  lowConfidenceIds?: Set<string>;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" dataKey={xKey as any} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis type="number" dataKey={yKey as any} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <ZAxis type="number" dataKey={zKey as any} range={[60, 600]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 2px 8px rgba(15,23,42,0.08)" }}
          formatter={((_value: unknown, _name: string, item: { payload: T }) => [tooltipFormatter(item.payload), ""]) as any}
          labelFormatter={() => ""}
        />
        <Scatter data={data} dataKey={yKey as any}>
          {data.map((d, i) => {
            const id = String(d[labelKey]);
            const lowConfidence = lowConfidenceIds?.has(id) ?? false;
            return <Cell key={i} fill={colorFor(d)} opacity={lowConfidence ? 0.4 : 0.85} />;
          })}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
