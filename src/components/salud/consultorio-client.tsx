"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEvents } from "@/components/use-events";

/**
 * 070 — Tablero del consultorio: urgencias abiertas (llegan en vivo), métricas
 * de los últimos 30 días y la lista de espera.
 */

type Metrics = {
  totals: {
    total: number;
    agendadas: number;
    realizadas: number;
    noShow: number;
    canceladas: number;
    canceladasPorPaciente: number;
  };
  absenteeismRate: number | null;
  cancellationRate: number | null;
  confirmationRate: number | null;
  lostSlots: number;
  lostMinutes: number;
  depositsPending: number;
  survey: { responses: number; average: number | null };
  perProfessional: {
    professionalId: string | null;
    name: string;
    booked: number;
    availableMinutes: number;
    occupancy: number | null;
    noShow: number;
  }[];
};
type Triage = {
  id: string;
  level: "urgente" | "prioritario";
  reason: string;
  contactName: string;
  conversationId: string;
  createdAt: string;
};
type Waiting = {
  id: string;
  contactName: string;
  preferences: string | null;
  status: "waiting" | "offered";
  createdAt: string;
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);

export function ConsultorioClient() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [triage, setTriage] = useState<Triage[]>([]);
  const [waitlist, setWaitlist] = useState<Waiting[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const [m, t, w] = await Promise.all([
      fetch("/api/salud/metrics").catch(() => null),
      fetch("/api/salud/triage").catch(() => null),
      fetch("/api/salud/waitlist").catch(() => null),
    ]);
    if (m?.ok) setMetrics(((await m.json()) as { metrics: Metrics }).metrics);
    else setFailed(true);
    if (t?.ok) setTriage(((await t.json()) as { triage: Triage[] }).triage);
    if (w?.ok) setWaitlist(((await w.json()) as { waitlist: Waiting[] }).waitlist);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEvents({ onTriageNew: () => void load(), onBookingUpdated: () => void load(), onReconnect: () => void load() });

  async function resolve(id: string) {
    await fetch(`/api/salud/triage/${id}`, { method: "DELETE" }).catch(() => null);
    void load();
  }
  async function removeWaiting(id: string) {
    await fetch(`/api/salud/waitlist/${id}`, { method: "DELETE" }).catch(() => null);
    void load();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <h2 className="text-[17px] font-bold tracking-tight">Consultorio</h2>

      {triage.length > 0 && (
        <Card className="border-danger-soft">
          <CardHeader>
            <CardTitle>Urgencias sin atender ({triage.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {triage.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                <Badge variant={t.level === "urgente" ? "destructive" : "warning"}>
                  {t.level === "urgente" ? "Urgente" : "Prioritario"}
                </Badge>
                <span className="text-sm font-semibold">{t.contactName}</span>
                <span className="text-sm text-text-3">{t.reason}</span>
                <span className="ml-auto flex gap-2">
                  <Link
                    href={`/inbox?conversation=${t.conversationId}`}
                    className="text-sm font-semibold text-brand-text hover:underline"
                  >
                    Abrir conversación
                  </Link>
                  <Button size="sm" variant="outline" onClick={() => void resolve(t.id)}>
                    Atendida
                  </Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {failed && !metrics && <p className="text-sm text-text-3">No se pudieron cargar las métricas.</p>}

      {metrics && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Ausentismo" value={pct(metrics.absenteeismRate)} hint="no vinieron / atendidos + ausentes" />
            <Stat label="Cancelaciones" value={pct(metrics.cancellationRate)} />
            <Stat label="Confirmados" value={pct(metrics.confirmationRate)} />
            <Stat
              label="Huecos perdidos"
              value={String(metrics.lostSlots)}
              hint={`${Math.round(metrics.lostMinutes / 60)} h sin atender`}
            />
            <Stat label="Turnos" value={String(metrics.totals.total)} />
            <Stat label="Realizados" value={String(metrics.totals.realizadas)} />
            <Stat label="Señas pendientes" value={String(metrics.depositsPending)} />
            <Stat
              label="Encuesta"
              value={metrics.survey.average === null ? "—" : `${metrics.survey.average.toFixed(1)} / 5`}
              hint={`${metrics.survey.responses} respuestas`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Por profesional (últimos 30 días)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-3">
                    <th className="py-1 pr-3 font-medium">Profesional</th>
                    <th className="py-1 pr-3 font-medium">Turnos</th>
                    <th className="py-1 pr-3 font-medium">Ocupación</th>
                    <th className="py-1 font-medium">Ausentes</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.perProfessional.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-2 text-text-3">
                        Todavía no hay turnos en el período.
                      </td>
                    </tr>
                  )}
                  {metrics.perProfessional.map((p) => (
                    <tr key={p.professionalId ?? "sin"} className="border-t">
                      <td className="py-1.5 pr-3 font-medium">{p.name}</td>
                      <td className="py-1.5 pr-3">{p.booked}</td>
                      <td className="py-1.5 pr-3">{pct(p.occupancy)}</td>
                      <td className="py-1.5">{p.noShow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lista de espera ({waitlist.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {waitlist.length === 0 && <p className="text-sm text-text-3">Nadie esperando.</p>}
          {waitlist.map((w) => (
            <div key={w.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <span className="font-semibold">{w.contactName}</span>
              {w.status === "offered" && <Badge variant="warning">Hueco ofrecido</Badge>}
              {w.preferences && <span className="text-text-3">{w.preferences}</span>}
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => void removeWaiting(w.id)}>
                Quitar
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-text-3">{label}</p>
        <p className="text-xl font-bold tracking-tight">{value}</p>
        {hint && <p className="text-[11px] text-text-3">{hint}</p>}
      </CardContent>
    </Card>
  );
}
