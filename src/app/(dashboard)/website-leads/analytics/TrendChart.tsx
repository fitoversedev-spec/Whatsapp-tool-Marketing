"use client";

// Deep imports bypass Next.js's automatic barrel optimization, which races with
// OneDrive file sync on Windows (same reason as the other chart files).
import { Area } from "recharts/es6/cartesian/Area";
import { AreaChart } from "recharts/es6/chart/AreaChart";
import { CartesianGrid } from "recharts/es6/cartesian/CartesianGrid";
import { ResponsiveContainer } from "recharts/es6/component/ResponsiveContainer";
import { Tooltip } from "recharts/es6/component/Tooltip";
import { XAxis } from "recharts/es6/cartesian/XAxis";
import { YAxis } from "recharts/es6/cartesian/YAxis";
import { fmtDay } from "./helpers";

export type TrendSeries = { key: string; label: string; color: string; axis?: "right" };

const TT: React.CSSProperties = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid rgb(var(--line))",
  boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
  background: "var(--panel)",
  color: "rgb(var(--tx))",
  padding: "8px 12px",
};
const TICK = { fontSize: 11, fill: "rgb(var(--dim))" };

// A per-day area chart. A series marked axis:"right" gets its own scale, so a
// small number (leads) stays visible next to a big one (visitors).
export default function TrendChart({
  data,
  series,
  height = 220,
}: {
  data: ({ date: string } & Record<string, string | number>)[];
  series: TrendSeries[];
  height?: number;
}) {
  const hasRight = series.some((s) => s.axis === "right");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
            {s.axis === "right" && <span className="text-slate-400">(right scale)</span>}
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: hasRight ? 0 : 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
          <XAxis
            dataKey="date"
            tick={TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
            tickFormatter={(v) => fmtDay(String(v))}
          />
          <YAxis yAxisId="left" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} width={44} />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={TICK}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={36}
            />
          )}
          <Tooltip contentStyle={TT} labelFormatter={(label) => fmtDay(String(label), true)} />
          {series.map((s) => (
            <Area
              key={s.key}
              yAxisId={s.axis ?? "left"}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.15}
              strokeWidth={2}
              dot={data.length < 3 ? { r: 3 } : false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
