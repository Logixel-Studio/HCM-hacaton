"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "@/lib/theme";

export const SERIES = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#f43f5e", "#14b8a6", "#6366f1", "#64748b"];

function useTip() {
  const { colors } = useTheme();
  return {
    contentStyle: { borderRadius: 12, border: `1px solid ${colors.line}`, background: colors.surface, color: colors.ink, boxShadow: "0 12px 40px -12px rgba(16,24,40,.25)", fontSize: 12 },
    itemStyle: { color: colors.ink },
    labelStyle: { color: colors.axis },
  };
}

const compact = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e3 ? Math.round(v / 1e3) + "k" : String(v));

export function TrendArea({ data, xKey = "label", series, height = 240, money = false }: {
  data: Record<string, unknown>[]; xKey?: string; series: { key: string; label: string }[]; height?: number; money?: boolean;
}) {
  const { colors } = useTheme();
  const tip = useTip();
  const palette = [colors.brand, "#8b5cf6", "#f59e0b"];
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette[i]} stopOpacity={0.28} /><stop offset="100%" stopColor={palette[i]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fill: colors.axis, fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: colors.axis, fontSize: 11 }} tickFormatter={(v) => (money ? compact(v) : String(v))} allowDecimals={false} />
          <Tooltip {...tip} formatter={(v, n) => [money ? "PKR " + Math.round(Number(v)).toLocaleString() : String(v), String(n)]} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: colors.axis }} />}
          {series.map((s, i) => (
            <Area key={s.key} name={s.label} type="monotone" dataKey={s.key} stroke={palette[i]} strokeWidth={2.5} fill={`url(#grad-${s.key})`}
              dot={{ r: 3, fill: colors.surface, stroke: palette[i], strokeWidth: 2 }} activeDot={{ r: 5 }} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Bars({ data, height = 240, money = false, highlight = "last", horizontal = false }: {
  data: { label: string; value: number }[]; height?: number; money?: boolean; highlight?: "last" | "max" | "all"; horizontal?: boolean;
}) {
  const { colors } = useTheme();
  const tip = useTip();
  const max = Math.max(0, ...data.map((d) => d.value));
  const fill = (d: { value: number }, i: number) =>
    highlight === "all" || (highlight === "last" && i === data.length - 1) || (highlight === "max" && d.value === max) ? colors.brand : colors.brandSoft;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 10, right: 8, left: horizontal ? 10 : -12, bottom: 0 }}>
          <CartesianGrid stroke={colors.grid} vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: colors.axis, fontSize: 11 }} tickFormatter={(v) => (money ? compact(v) : String(v))} />
              <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} tick={{ fill: colors.axis, fontSize: 12 }} width={110} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: colors.axis, fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: colors.axis, fontSize: 11 }} tickFormatter={(v) => (money ? compact(v) : String(v))} allowDecimals={false} />
            </>
          )}
          <Tooltip {...tip} cursor={{ fill: colors.grid, radius: 10 }} formatter={(v) => [money ? "PKR " + Math.round(Number(v)).toLocaleString() : String(v), ""]} />
          <Bar dataKey="value" radius={[10, 10, 10, 10]} barSize={horizontal ? 18 : 26}>
            {data.map((d, i) => <Cell key={i} fill={fill(d, i)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({ data, center, sub, size = 144 }: { data: { name: string; value: number; color?: string }[]; center: React.ReactNode; sub: string; size?: number }) {
  const tip = useTip();
  const rows = data.map((d, i) => ({ ...d, color: d.color || SERIES[i % SERIES.length] }));
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ height: size, width: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows.length && rows.some((r) => r.value > 0) ? rows : [{ name: "None", value: 1, color: "#cbd5e1" }]} dataKey="value" innerRadius={size * 0.31} outerRadius={size * 0.46} paddingAngle={2} stroke="none">
              {(rows.length && rows.some((r) => r.value > 0) ? rows : [{ name: "None", value: 1, color: "#cbd5e1" }]).map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip {...tip} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-xl font-bold text-ink">{center}</span><span className="text-[11px] text-ink-soft">{sub}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {rows.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-ink-soft"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} /><span className="truncate">{d.name}</span></span>
            <span className="font-medium tabular text-ink">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
