import { and, eq, gte, isNull, lte, max } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  addDaysISO,
  eachDateInRange,
  todayInTz,
  weekdayKeyOf,
  zonedWallClockToUtc,
} from "@/lib/time/slots";
import { getSettings, type WeeklyHours } from "@/server/agenda/settings";
import { normalizeWeeklyHours } from "@/server/agenda/settings";
import { getHealthSettings } from "@/server/salud/settings";

/**
 * 070 — Métricas del consultorio: ausentismo, ocupación por profesional,
 * turnos perdidos, pacientes que no volvieron y satisfacción.
 *
 * Todo se calcula con los datos que ya tiene el CRM; no pide conectar nada.
 */

export type MetricBooking = {
  professionalId: string | null;
  status: "agendada" | "realizada" | "no_show" | "cancelada";
  confirmation: "pendiente" | "confirmada" | "cancelada_paciente";
  durationMinutes: number;
  surveyScore: number | null;
  depositStatus: "no_aplica" | "pendiente" | "pagada";
};

export type ProfessionalMetrics = {
  professionalId: string | null;
  name: string;
  booked: number;
  bookedMinutes: number;
  availableMinutes: number;
  /** 0..1 o null si no tiene horario cargado. */
  occupancy: number | null;
  noShow: number;
};

export type HealthMetrics = {
  totals: {
    total: number;
    agendadas: number;
    realizadas: number;
    noShow: number;
    canceladas: number;
    canceladasPorPaciente: number;
  };
  /** no_show / (realizadas + no_show); null sin datos. */
  absenteeismRate: number | null;
  /** canceladas / total; null sin datos. */
  cancellationRate: number | null;
  /** Confirmadas / (turnos no cancelados); null sin datos. */
  confirmationRate: number | null;
  lostSlots: number;
  lostMinutes: number;
  depositsPending: number;
  survey: { responses: number; average: number | null };
  perProfessional: ProfessionalMetrics[];
};

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** PURA: minutos de atención que un horario semanal ofrece entre dos fechas (inclusive). */
export function availableMinutesInRange(
  weeklyHours: WeeklyHours,
  fromISO: string,
  toISO: string,
  timezone: string
): number {
  let total = 0;
  for (const date of eachDateInRange(fromISO, toISO)) {
    const key = weekdayKeyOf(date, timezone);
    if (!key) continue;
    for (const iv of weeklyHours[key] ?? []) {
      const [sh = 0, sm = 0] = iv.start.split(":").map(Number);
      const [eh = 0, em = 0] = iv.end.split(":").map(Number);
      const mins = eh * 60 + em - (sh * 60 + sm);
      if (mins > 0) total += mins;
    }
  }
  return total;
}

/** PURA: arma las métricas a partir de las citas del período. */
export function computeMetrics(input: {
  bookings: MetricBooking[];
  professionals: {
    id: string;
    name: string;
    availableMinutes: number;
  }[];
}): HealthMetrics {
  const t = {
    total: 0,
    agendadas: 0,
    realizadas: 0,
    noShow: 0,
    canceladas: 0,
    canceladasPorPaciente: 0,
  };
  let lostMinutes = 0;
  let depositsPending = 0;
  let confirmed = 0;
  let nonCancelled = 0;
  let surveySum = 0;
  let surveyN = 0;

  const per = new Map<string | null, ProfessionalMetrics>();
  for (const p of input.professionals) {
    per.set(p.id, {
      professionalId: p.id,
      name: p.name,
      booked: 0,
      bookedMinutes: 0,
      availableMinutes: p.availableMinutes,
      occupancy: null,
      noShow: 0,
    });
  }
  const sin = (): ProfessionalMetrics => {
    let e = per.get(null);
    if (!e) {
      e = {
        professionalId: null,
        name: "Sin profesional asignado",
        booked: 0,
        bookedMinutes: 0,
        availableMinutes: 0,
        occupancy: null,
        noShow: 0,
      };
      per.set(null, e);
    }
    return e;
  };

  for (const b of input.bookings) {
    t.total += 1;
    const bucket =
      (b.professionalId ? per.get(b.professionalId) : undefined) ?? sin();
    if (b.status === "agendada") t.agendadas += 1;
    if (b.status === "realizada") t.realizadas += 1;
    if (b.status === "no_show") {
      t.noShow += 1;
      bucket.noShow += 1;
      lostMinutes += b.durationMinutes;
    }
    if (b.status === "cancelada") {
      t.canceladas += 1;
      lostMinutes += b.durationMinutes;
      if (b.confirmation === "cancelada_paciente") t.canceladasPorPaciente += 1;
    }
    if (b.status === "agendada" || b.status === "realizada") {
      bucket.booked += 1;
      bucket.bookedMinutes += b.durationMinutes;
    }
    if (b.status !== "cancelada") {
      nonCancelled += 1;
      if (b.confirmation === "confirmada") confirmed += 1;
    }
    if (b.depositStatus === "pendiente" && b.status === "agendada") {
      depositsPending += 1;
    }
    if (b.surveyScore !== null) {
      surveySum += b.surveyScore;
      surveyN += 1;
    }
  }

  for (const e of per.values()) {
    e.occupancy =
      e.availableMinutes > 0
        ? round(Math.min(1, e.bookedMinutes / e.availableMinutes))
        : null;
  }

  const attended = t.realizadas + t.noShow;
  return {
    totals: t,
    absenteeismRate: attended > 0 ? round(t.noShow / attended) : null,
    cancellationRate: t.total > 0 ? round(t.canceladas / t.total) : null,
    confirmationRate: nonCancelled > 0 ? round(confirmed / nonCancelled) : null,
    lostSlots: t.noShow + t.canceladas,
    lostMinutes,
    depositsPending,
    survey: {
      responses: surveyN,
      average: surveyN > 0 ? round(surveySum / surveyN, 2) : null,
    },
    perProfessional: [...per.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "es")
    ),
  };
}

export type MetricsRange = { from: string; to: string };

/** Últimos 30 días (días del negocio) si no se indica rango. */
export function defaultRange(timezone: string, now: Date = new Date()): MetricsRange {
  const to = todayInTz(now, timezone);
  return { from: addDaysISO(to, -29), to };
}

export async function getHealthMetrics(
  organizationId: string,
  range?: MetricsRange,
  now: Date = new Date()
): Promise<{
  range: MetricsRange;
  metrics: HealthMetrics;
  patientsNotReturned: number;
  waitlistWaiting: number;
  urgentOpen: number;
}> {
  const db = getDb();
  const settings = await getSettings(organizationId);
  const tz = settings.timezone;
  const r = range ?? defaultRange(tz, now);
  const fromUtc = zonedWallClockToUtc(r.from, "00:00", tz) ?? new Date(0);
  const toUtc =
    zonedWallClockToUtc(addDaysISO(r.to, 1), "00:00", tz) ?? new Date();

  const pros = await db
    .select()
    .from(schema.professional)
    .where(eq(schema.professional.organizationId, organizationId));
  const proInfo = pros.map((p) => ({
    id: p.id,
    name: p.name,
    availableMinutes: availableMinutesInRange(
      p.weeklyHours ? normalizeWeeklyHours(p.weeklyHours) : settings.weeklyHours,
      r.from,
      r.to,
      tz
    ),
  }));

  const rows = await db
    .select({
      professionalId: schema.booking.professionalId,
      status: schema.booking.status,
      confirmation: schema.booking.confirmation,
      durationMinutes: schema.booking.durationMinutes,
      surveyScore: schema.booking.surveyScore,
      depositStatus: schema.booking.depositStatus,
    })
    .from(schema.booking)
    .where(
      and(
        eq(schema.booking.organizationId, organizationId),
        eq(schema.booking.kind, "session"),
        eq(schema.booking.isTest, false),
        gte(schema.booking.scheduledAt, fromUtc),
        lte(schema.booking.scheduledAt, toUtc)
      )
    );

  const metrics = computeMetrics({ bookings: rows, professionals: proInfo });

  // Pacientes que no volvieron: última visita realizada hace más de N meses y
  // sin turno futuro.
  const health = await getHealthSettings(organizationId);
  const threshold = new Date(now);
  threshold.setUTCMonth(threshold.getUTCMonth() - health.reactivationMonths);
  const last = await db
    .select({
      contactId: schema.booking.contactId,
      lastVisitAt: max(schema.booking.scheduledAt),
    })
    .from(schema.booking)
    .where(
      and(
        eq(schema.booking.organizationId, organizationId),
        eq(schema.booking.kind, "session"),
        eq(schema.booking.status, "realizada"),
        eq(schema.booking.isTest, false)
      )
    )
    .groupBy(schema.booking.contactId);
  const old = last.filter((l) => l.lastVisitAt && l.lastVisitAt <= threshold);
  const future = await db
    .select({ contactId: schema.booking.contactId })
    .from(schema.booking)
    .where(
      and(
        eq(schema.booking.organizationId, organizationId),
        eq(schema.booking.status, "agendada"),
        gte(schema.booking.scheduledAt, now)
      )
    );
  const futureSet = new Set(future.map((f) => f.contactId));
  const patientsNotReturned = old.filter(
    (l) => l.contactId && !futureSet.has(l.contactId)
  ).length;

  const waiting = await db
    .select({ id: schema.waitlistEntry.id })
    .from(schema.waitlistEntry)
    .where(
      and(
        eq(schema.waitlistEntry.organizationId, organizationId),
        eq(schema.waitlistEntry.status, "waiting")
      )
    );
  const urgent = await db
    .select({ id: schema.triageEvent.id })
    .from(schema.triageEvent)
    .where(
      and(
        eq(schema.triageEvent.organizationId, organizationId),
        eq(schema.triageEvent.level, "urgente"),
        isNull(schema.triageEvent.resolvedAt)
      )
    );

  return {
    range: r,
    metrics,
    patientsNotReturned,
    waitlistWaiting: waiting.length,
    urgentOpen: urgent.length,
  };
}
