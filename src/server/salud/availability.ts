import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  computeAvailability,
  type AvailableSlot,
} from "@/server/agenda/availability";
import {
  normalizeWeeklyHours,
  type CalendarSettings,
} from "@/server/agenda/settings";
import {
  getAppointmentType,
  getProfessional,
  SaludError,
  type AppointmentTypeRow,
  type ProfessionalRow,
} from "@/server/salud/catalog";

/**
 * 070 — Disponibilidad por profesional, tipo de turno y obra social.
 *
 * Sin profesionales activos esto devuelve EXACTAMENTE lo de la agenda de
 * siempre (un solo calendario): el vertical salud es aditivo.
 */

export type ScopedSlot = AvailableSlot & {
  professionalId: string | null;
  professionalName: string | null;
  appointmentTypeId: string | null;
};

export type ScopeInput = {
  professionalId?: string | null;
  appointmentTypeId?: string | null;
  insuranceId?: string | null;
};

export type ResolvedScope = {
  professionals: ProfessionalRow[];
  type: AppointmentTypeRow | null;
  /** true ⇒ no hay profesionales: agenda única de siempre. */
  legacy: boolean;
};

/** PURA: ¿atiende el profesional este tipo de turno? Sin filas, atiende todos. */
export function servesType(
  typeIdsOfProfessional: string[],
  appointmentTypeId: string
): boolean {
  return (
    typeIdsOfProfessional.length === 0 ||
    typeIdsOfProfessional.includes(appointmentTypeId)
  );
}

/** PURA: ¿acepta la obra social? Un profesional sin ninguna cargada acepta todas. */
export function acceptsInsurance(
  insuranceIdsOfProfessional: string[],
  insuranceId: string
): boolean {
  return (
    insuranceIdsOfProfessional.length === 0 ||
    insuranceIdsOfProfessional.includes(insuranceId)
  );
}

export async function resolveScope(
  organizationId: string,
  input: ScopeInput
): Promise<ResolvedScope> {
  const db = getDb();
  const type = input.appointmentTypeId
    ? await getAppointmentType(organizationId, input.appointmentTypeId)
    : null;
  if (input.appointmentTypeId && (!type || !type.active)) {
    throw new SaludError("not_found", "Tipo de turno no encontrado");
  }

  const active = await db
    .select()
    .from(schema.professional)
    .where(
      scoped(
        schema.professional.organizationId,
        organizationId,
        eq(schema.professional.active, true)
      )
    );

  if (active.length === 0) {
    if (input.professionalId) {
      throw new SaludError("not_found", "Profesional no encontrado");
    }
    return { professionals: [], type, legacy: true };
  }

  let candidates = active;
  if (input.professionalId) {
    const one = active.find((p) => p.id === input.professionalId);
    if (!one) throw new SaludError("not_found", "Profesional no encontrado");
    candidates = [one];
  }
  candidates = [...candidates].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es")
  );

  const ids = candidates.map((p) => p.id);
  const typeRows = type
    ? await db
        .select()
        .from(schema.professionalAppointmentType)
        .where(inArray(schema.professionalAppointmentType.professionalId, ids))
    : [];
  const insRows = input.insuranceId
    ? await db
        .select()
        .from(schema.professionalInsurance)
        .where(inArray(schema.professionalInsurance.professionalId, ids))
    : [];

  const filtered = candidates.filter((p) => {
    if (type) {
      const mine = typeRows
        .filter((r) => r.professionalId === p.id)
        .map((r) => r.appointmentTypeId);
      if (!servesType(mine, type.id)) return false;
    }
    if (input.insuranceId) {
      const mine = insRows
        .filter((r) => r.professionalId === p.id)
        .map((r) => r.insuranceId);
      if (!acceptsInsurance(mine, input.insuranceId)) return false;
    }
    return true;
  });

  return { professionals: filtered, type, legacy: false };
}

/** PURA: une las agendas de varios profesionales; el mismo instante se ofrece una vez. */
export function mergeSlots(perProfessional: ScopedSlot[][]): ScopedSlot[] {
  const seen = new Set<string>();
  const out: ScopedSlot[] = [];
  for (const slots of perProfessional) {
    for (const s of slots) {
      // Sin profesional elegido, el primero libre (por orden) se queda con el hueco.
      if (seen.has(s.startUtc)) continue;
      seen.add(s.startUtc);
      out.push(s);
    }
  }
  return out.sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
}

function scopeOf(p: ProfessionalRow) {
  return {
    id: p.id,
    weeklyHours: p.weeklyHours ? normalizeWeeklyHours(p.weeklyHours) : null,
    slotMinutes: p.slotMinutes,
    bufferMinutes: p.bufferMinutes,
  };
}

export async function computeScopedAvailability(
  organizationId: string,
  input: ScopeInput,
  opts?: {
    fromISO?: string;
    toISO?: string;
    now?: Date;
    settings?: CalendarSettings;
    excludeBookingId?: string;
  }
): Promise<ScopedSlot[]> {
  const scope = await resolveScope(organizationId, input);
  const durationMinutes = scope.type?.durationMinutes ?? null;

  if (scope.legacy) {
    const slots = await computeAvailability(organizationId, {
      ...opts,
      durationMinutes,
    });
    return slots.map((s) => ({
      ...s,
      professionalId: null,
      professionalName: null,
      appointmentTypeId: scope.type?.id ?? null,
    }));
  }

  const perPro = await Promise.all(
    scope.professionals.map(async (p) => {
      const slots = await computeAvailability(organizationId, {
        ...opts,
        professional: scopeOf(p),
        durationMinutes,
      });
      return slots.map(
        (s): ScopedSlot => ({
          ...s,
          professionalId: p.id,
          professionalName: p.name,
          appointmentTypeId: scope.type?.id ?? null,
        })
      );
    })
  );
  return mergeSlots(perPro);
}

/** El ProfessionalScope de un profesional ya cargado (para findSlot al reservar). */
export async function loadProfessionalScope(
  organizationId: string,
  professionalId: string
) {
  const p = await getProfessional(organizationId, professionalId);
  if (!p || !p.active) {
    throw new SaludError("not_found", "Profesional no encontrado");
  }
  return { row: p, scope: scopeOf(p) };
}

/** ¿Atiende este profesional este tipo? Consulta puntual para validar una reserva. */
export async function professionalServesType(
  organizationId: string,
  professionalId: string,
  appointmentTypeId: string
): Promise<boolean> {
  const rows = await getDb()
    .select()
    .from(schema.professionalAppointmentType)
    .where(
      and(
        eq(schema.professionalAppointmentType.organizationId, organizationId),
        eq(schema.professionalAppointmentType.professionalId, professionalId)
      )
    );
  return servesType(
    rows.map((r) => r.appointmentTypeId),
    appointmentTypeId
  );
}
