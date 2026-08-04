"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

/** Paleta minimalista y estable por índice de etapa — no depende del brand del cliente. */
const PALETTE = ["#2563EB", "#7C3AED", "#0D9488", "#F59E0B", "#EF4444", "#64748B"];

type StatsResponse = {
  month: string;
  funnel: { stageId: string; name: string; kind: string; count: number }[];
  dailyVolume: { day: string; count: number }[];
  totals: {
    leadsActivos: number;
    leadsNuevosDelMes: number;
    conversacionesDelMes: number;
    tasaHandoff: number;
    tasaConversion: number;
  };
};

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string): string {
  const parts = value.split("-").map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function StatsClient() {
  const [month, setMonth] = useState(currentMonthValue());
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/stats?month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error("No se pudieron cargar las estadísticas");
        return res.json();
      })
      .then((json: StatsResponse) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Error desconocido");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const monthOptions = useMemo(() => {
    const opts: string[] = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return opts;
  }, []);

  const dailyVolumeChart = useMemo(
    () =>
      (data?.dailyVolume ?? []).map((d) => ({
        day: d.day.slice(8, 10),
        consultas: d.count,
      })),
    [data]
  );

  const funnelChart = useMemo(
    () => (data?.funnel ?? []).map((f) => ({ name: f.name, cantidad: f.count, kind: f.kind })),
    [data]
  );

  const pieChart = useMemo(
    () =>
      (data?.funnel ?? [])
        .filter((f) => f.count > 0)
        .map((f) => ({ name: f.name, value: f.count })),
    [data]
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-[650] tracking-tight">Estadísticas</h1>
          <p className="text-[13px] text-text-3">
            {data ? `Datos de ${monthLabel(data.month)}` : "Cargando…"}
          </p>
        </div>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-sm border bg-background px-3 py-1.5 text-sm font-medium text-text-2 outline-none focus:border-brand"
        >
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ---- Tarjetas de % clave ---- */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Consultas del mes" value={data?.totals.conversacionesDelMes ?? "—"} loading={loading} />
        <StatCard label="Leads nuevos" value={data?.totals.leadsNuevosDelMes ?? "—"} loading={loading} />
        <StatCard
          label="Tasa de conversión"
          value={data ? `${data.totals.tasaConversion}%` : "—"}
          loading={loading}
          accent="text-emerald-600"
        />
        <StatCard
          label="Escaló a humano"
          value={data ? `${data.totals.tasaHandoff}%` : "—"}
          loading={loading}
          accent="text-amber-600"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ---- Embudo (barras) ---- */}
        <ChartCard title="Embudo de conversión" subtitle="Leads activos por etapa, hoy">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnelChart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-3)" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--text-3)" />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--border)" }}
              />
              <Bar dataKey="cantidad" radius={[4, 4, 0, 0]}>
                {funnelChart.map((entry, i) => (
                  <Cell key={entry.name} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* ---- Volumen diario (línea) ---- */}
        <ChartCard title="Consultas por día" subtitle="Mensajes entrantes reales del mes">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dailyVolumeChart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--text-3)" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--text-3)" />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--border)" }}
              />
              <Line
                type="monotone"
                dataKey="consultas"
                stroke="#2563EB"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* ---- Distribución por etapa (torta) ---- */}
        <ChartCard title="Dónde están tus leads" subtitle="Distribución actual por etapa">
          {pieChart.length === 0 ? (
            <EmptyState loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieChart}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {pieChart.map((entry, i) => (
                    <Cell key={entry.name} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--border)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
          <Legend items={pieChart.map((p, i) => ({ ...p, color: PALETTE[i % PALETTE.length] ?? "#64748B" }))} />
        </ChartCard>

        {/* ---- Resumen ---- */}
        <ChartCard title="Resumen del mes" subtitle="Lectura rápida">
          <ul className="flex flex-col gap-3 py-1 text-sm">
            <SummaryRow
              label="Leads activos en el pipeline"
              value={data?.totals.leadsActivos}
              loading={loading}
            />
            <SummaryRow
              label="Leads nuevos este mes"
              value={data?.totals.leadsNuevosDelMes}
              loading={loading}
            />
            <SummaryRow
              label="Conversaciones reales del mes"
              value={data?.totals.conversacionesDelMes}
              loading={loading}
            />
            <SummaryRow
              label="Tasa de conversión a cliente"
              value={data ? `${data.totals.tasaConversion}%` : undefined}
              loading={loading}
            />
          </ul>
        </ChartCard>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  accent,
}: {
  label: string;
  value: string | number;
  loading: boolean;
  accent?: string;
}) {
  return (
    <div className="rounded-sm border bg-background p-3.5">
      <div className="text-[11px] font-medium text-text-3">{label}</div>
      <div
        className={cn(
          "mt-1 text-[22px] font-[650] tabular-nums tracking-tight",
          loading && "animate-pulse text-text-4",
          accent
        )}
      >
        {loading ? "···" : value}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border bg-background p-4">
      <div className="mb-3">
        <h3 className="text-[13.5px] font-[650]">{title}</h3>
        <p className="text-[11.5px] text-text-3">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function Legend({ items }: { items: { name: string; value: number; color: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <div key={it.name} className="flex items-center gap-1.5 text-[11.5px] text-text-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: it.color }}
            aria-hidden
          />
          {it.name} · {it.value}
        </div>
      ))}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | number | undefined;
  loading: boolean;
}) {
  return (
    <li className="flex items-center justify-between border-b pb-2.5 last:border-0 last:pb-0">
      <span className="text-text-2">{label}</span>
      <span className={cn("font-semibold tabular-nums", loading && "animate-pulse text-text-4")}>
        {loading ? "···" : value ?? "—"}
      </span>
    </li>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-[13px] text-text-3">
      {loading ? "Cargando…" : "Todavía no hay leads para mostrar."}
    </div>
  );
}
