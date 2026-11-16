import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { normalizeWeeklyHours, type WeeklyHours } from "@/server/agenda/settings";

/**
 * 070 — Catálogo del consultorio: profesionales, tipos de turno y obras
 * sociales. Es lo que el agente lee para contestar «¿atienden OSDE?» o
 * «¿cuánto dura una limpieza?» sin inventar nada.
 */

export class SaludError extends Error {
  constructor(
    public code: "not_found" | "invalid" | "conflict",
    message: string
  ) {
    super(message);
    this.name = "SaludError";
  }
}

export type ProfessionalRow = typeof schema.professional.$inferSelect;
export type AppointmentTypeRow = typeof schema.appointmentType.$inferSelect;
export type InsuranceRow = typeof schema.insurance.$inferSelect;

export type ProfessionalDto = {
  id: string;
  name: string;
  specialty: string | null;
  color: string | null;
  active: boolean;
  weeklyHours: WeeklyHours | null;
  slotMinutes: number | null;
  bufferMinutes: number | null;
  meetingLink: string | null;
  sortOrder: number;
  appointmentTypeIds: string[];
  insurances: { insuranceId: string; copay: string | null }[];
};

function clampOpt(v: number | null | undefined, min: number, max: number) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function cleanText(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

/* ------------------------------ profesionales ------------------------------ */

export async function listProfessionals(
  organizationId: string,
  opts?: { onlyActive?: boolean }
): Promise<ProfessionalDto[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.professional)
    .where(
      scoped(
        schema.professional.organizationId,
        organizationId,
        opts?.onlyActive ? eq(schema.professional.active, true) : undefined
      )
    )
    .orderBy(asc(schema.professional.sortOrder), asc(schema.professional.name));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const types = await db
    .select()
    .from(schema.professionalAppointmentType)
    .where(inArray(schema.professionalAppointmentType.professionalId, ids));
  const ins = await db
    .select()
    .from(schema.professionalInsurance)
    .where(inArray(schema.professionalInsurance.professionalId, ids));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    color: r.color,
    active: r.active,
    weeklyHours: r.weeklyHours ? normalizeWeeklyHours(r.weeklyHours) : null,
    slotMinutes: r.slotMinutes,
    bufferMinutes: r.bufferMinutes,
    meetingLink: r.meetingLink,
    sortOrder: r.sortOrder,
    appointmentTypeIds: types
      .filter((t) => t.professionalId === r.id)
      .map((t) => t.appointmentTypeId),
    insurances: ins
      .filter((i) => i.professionalId === r.id)
      .map((i) => ({ insuranceId: i.insuranceId, copay: i.copay })),
  }));
}

export async function getProfessional(
  organizationId: string,
  id: string
): Promise<ProfessionalRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.professional)
    .where(
      scoped(
        schema.professional.organizationId,
        organizationId,
        eq(schema.professional.id, id)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export type ProfessionalInput = {
  name?: string;
  specialty?: string | null;
  color?: string | null;
  active?: boolean;
  weeklyHours?: unknown | null;
  slotMinutes?: number | null;
  bufferMinutes?: number | null;
  meetingLink?: string | null;
  sortOrder?: number;
  appointmentTypeIds?: string[];
  insurances?: { insuranceId: string; copay?: string | null }[];
};

export async function createProfessional(
  organizationId: string,
  input: ProfessionalInput & { name: string }
): Promise<ProfessionalDto> {
  const name = input.name.trim();
  if (!name) throw new SaludError("invalid", "El profesional necesita un nombre");
  const id = newId("professional");
  await getDb()
    .insert(schema.professional)
    .values({
      id,
      organizationId,
      name,
      specialty: cleanText(input.specialty),
      color: cleanText(input.color),
      active: input.active ?? true,
      weeklyHours:
        input.weeklyHours === undefined || input.weeklyHours === null
          ? null
          : normalizeWeeklyHours(input.weeklyHours),
      slotMinutes: clampOpt(input.slotMinutes, 5, 240),
      bufferMinutes: clampOpt(input.bufferMinutes, 0, 120),
      meetingLink: cleanText(input.meetingLink),
      sortOrder: input.sortOrder ?? 0,
    });
  if (input.appointmentTypeIds) {
    await setProfessionalTypes(organizationId, id, input.appointmentTypeIds);
  }
  if (input.insurances) {
    await setProfessionalInsurances(organizationId, id, input.insurances);
  }
  return (await listProfessionals(organizationId)).find((p) => p.id === id)!;
}

export async function updateProfessional(
  organizationId: string,
  id: string,
  input: ProfessionalInput
): Promise<ProfessionalDto> {
  const current = await getProfessional(organizationId, id);
  if (!current) throw new SaludError("not_found", "Profesional no encontrado");
  const set: Partial<typeof schema.professional.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new SaludError("invalid", "El nombre no puede quedar vacío");
    set.name = name;
  }
  if (input.specialty !== undefined) set.specialty = cleanText(input.specialty);
  if (input.color !== undefined) set.color = cleanText(input.color);
  if (input.active !== undefined) set.active = input.active;
  if (input.weeklyHours !== undefined) {
    set.weeklyHours =
      input.weeklyHours === null ? null : normalizeWeeklyHours(input.weeklyHours);
  }
  if (input.slotMinutes !== undefined)
    set.slotMinutes = clampOpt(input.slotMinutes, 5, 240);
  if (input.bufferMinutes !== undefined)
    set.bufferMinutes = clampOpt(input.bufferMinutes, 0, 120);
  if (input.meetingLink !== undefined)
    set.meetingLink = cleanText(input.meetingLink);
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;

  await getDb()
    .update(schema.professional)
    .set(set)
    .where(
      scoped(
        schema.professional.organizationId,
        organizationId,
        eq(schema.professional.id, id)
      )
    );
  if (input.appointmentTypeIds) {
    await setProfessionalTypes(organizationId, id, input.appointmentTypeIds);
  }
  if (input.insurances) {
    await setProfessionalInsurances(organizationId, id, input.insurances);
  }
  return (await listProfessionals(organizationId)).find((p) => p.id === id)!;
}

/** Las citas del profesional quedan (professional_id pasa a null): se archiva, no se pierde historia. */
export async function deleteProfessional(
  organizationId: string,
  id: string
): Promise<void> {
  const current = await getProfessional(organizationId, id);
  if (!current) throw new SaludError("not_found", "Profesional no encontrado");
  await getDb()
    .delete(schema.professional)
    .where(
      scoped(
        schema.professional.organizationId,
        organizationId,
        eq(schema.professional.id, id)
      )
    );
}

async function setProfessionalTypes(
  organizationId: string,
  professionalId: string,
  typeIds: string[]
) {
  const db = getDb();
  const unique = [...new Set(typeIds)];
  if (unique.length > 0) {
    const found = await db
      .select({ id: schema.appointmentType.id })
      .from(schema.appointmentType)
      .where(
        scoped(
          schema.appointmentType.organizationId,
          organizationId,
          inArray(schema.appointmentType.id, unique)
        )
      );
    if (found.length !== unique.length) {
      throw new SaludError("invalid", "Hay un tipo de turno que no existe");
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.professionalAppointmentType)
      .where(eq(schema.professionalAppointmentType.professionalId, professionalId));
    if (unique.length > 0) {
      await tx.insert(schema.professionalAppointmentType).values(
        unique.map((appointmentTypeId) => ({
          organizationId,
          professionalId,
          appointmentTypeId,
        }))
      );
    }
  });
}

async function setProfessionalInsurances(
  organizationId: string,
  professionalId: string,
  items: { insuranceId: string; copay?: string | null }[]
) {
  const db = getDb();
  const byId = new Map(items.map((i) => [i.insuranceId, cleanText(i.copay)]));
  const ids = [...byId.keys()];
  if (ids.length > 0) {
    const found = await db
      .select({ id: schema.insurance.id })
      .from(schema.insurance)
      .where(
        scoped(
          schema.insurance.organizationId,
          organizationId,
          inArray(schema.insurance.id, ids)
        )
      );
    if (found.length !== ids.length) {
      throw new SaludError("invalid", "Hay una obra social que no existe");
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.professionalInsurance)
      .where(eq(schema.professionalInsurance.professionalId, professionalId));
    if (ids.length > 0) {
      await tx.insert(schema.professionalInsurance).values(
        ids.map((insuranceId) => ({
          organizationId,
          professionalId,
          insuranceId,
          copay: byId.get(insuranceId) ?? null,
        }))
      );
    }
  });
}

/* ------------------------------ tipos de turno ------------------------------ */

export async function listAppointmentTypes(
  organizationId: string,
  opts?: { onlyActive?: boolean }
): Promise<AppointmentTypeRow[]> {
  return getDb()
    .select()
    .from(schema.appointmentType)
    .where(
      scoped(
        schema.appointmentType.organizationId,
        organizationId,
        opts?.onlyActive ? eq(schema.appointmentType.active, true) : undefined
      )
    )
    .orderBy(
      asc(schema.appointmentType.sortOrder),
      asc(schema.appointmentType.name)
    );
}

export async function getAppointmentType(
  organizationId: string,
  id: string
): Promise<AppointmentTypeRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.appointmentType)
    .where(
      scoped(
        schema.appointmentType.organizationId,
        organizationId,
        eq(schema.appointmentType.id, id)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export type AppointmentTypeInput = {
  name?: string;
  durationMinutes?: number;
  price?: number | null;
  prepNotes?: string | null;
  depositAmount?: number | null;
  active?: boolean;
  sortOrder?: number;
};

function cleanMoney(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n > 0 ? n : null;
}

export async function createAppointmentType(
  organizationId: string,
  input: AppointmentTypeInput & { name: string; durationMinutes: number }
): Promise<AppointmentTypeRow> {
  const name = input.name.trim();
  if (!name) throw new SaludError("invalid", "El tipo de turno necesita un nombre");
  const duration = clampOpt(input.durationMinutes, 5, 480);
  if (!duration) throw new SaludError("invalid", "Duración inválida");
  const inserted = await getDb()
    .insert(schema.appointmentType)
    .values({
      id: newId("appointmentType"),
      organizationId,
      name,
      durationMinutes: duration,
      price: cleanMoney(input.price),
      prepNotes: cleanText(input.prepNotes),
      depositAmount: cleanMoney(input.depositAmount),
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return inserted[0]!;
}

export async function updateAppointmentType(
  organizationId: string,
  id: string,
  input: AppointmentTypeInput
): Promise<AppointmentTypeRow> {
  const current = await getAppointmentType(organizationId, id);
  if (!current) throw new SaludError("not_found", "Tipo de turno no encontrado");
  const set: Partial<typeof schema.appointmentType.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new SaludError("invalid", "El nombre no puede quedar vacío");
    set.name = name;
  }
  if (input.durationMinutes !== undefined) {
    const d = clampOpt(input.durationMinutes, 5, 480);
    if (!d) throw new SaludError("invalid", "Duración inválida");
    set.durationMinutes = d;
  }
  if (input.price !== undefined) set.price = cleanMoney(input.price);
  if (input.prepNotes !== undefined) set.prepNotes = cleanText(input.prepNotes);
  if (input.depositAmount !== undefined)
    set.depositAmount = cleanMoney(input.depositAmount);
  if (input.active !== undefined) set.active = input.active;
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  const updated = await getDb()
    .update(schema.appointmentType)
    .set(set)
    .where(
      scoped(
        schema.appointmentType.organizationId,
        organizationId,
        eq(schema.appointmentType.id, id)
      )
    )
    .returning();
  return updated[0]!;
}

export async function deleteAppointmentType(
  organizationId: string,
  id: string
): Promise<void> {
  const current = await getAppointmentType(organizationId, id);
  if (!current) throw new SaludError("not_found", "Tipo de turno no encontrado");
  await getDb()
    .delete(schema.appointmentType)
    .where(
      scoped(
        schema.appointmentType.organizationId,
        organizationId,
        eq(schema.appointmentType.id, id)
      )
    );
}

/* ------------------------------ obras sociales ------------------------------ */

export async function listInsurances(
  organizationId: string,
  opts?: { onlyActive?: boolean }
): Promise<InsuranceRow[]> {
  return getDb()
    .select()
    .from(schema.insurance)
    .where(
      scoped(
        schema.insurance.organizationId,
        organizationId,
        opts?.onlyActive ? eq(schema.insurance.active, true) : undefined
      )
    )
    .orderBy(asc(schema.insurance.name));
}

export async function createInsurance(
  organizationId: string,
  input: { name: string; notes?: string | null; active?: boolean }
): Promise<InsuranceRow> {
  const name = input.name.trim();
  if (!name) throw new SaludError("invalid", "La obra social necesita un nombre");
  try {
    const inserted = await getDb()
      .insert(schema.insurance)
      .values({
        id: newId("insurance"),
        organizationId,
        name,
        notes: cleanText(input.notes),
        active: input.active ?? true,
      })
      .returning();
    return inserted[0]!;
  } catch (err) {
    if (isUnique(err)) throw new SaludError("conflict", "Ya existe esa obra social");
    throw err;
  }
}

export async function updateInsurance(
  organizationId: string,
  id: string,
  input: { name?: string; notes?: string | null; active?: boolean }
): Promise<InsuranceRow> {
  const set: Partial<typeof schema.insurance.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new SaludError("invalid", "El nombre no puede quedar vacío");
    set.name = name;
  }
  if (input.notes !== undefined) set.notes = cleanText(input.notes);
  if (input.active !== undefined) set.active = input.active;
  try {
    const updated = await getDb()
      .update(schema.insurance)
      .set(set)
      .where(
        scoped(
          schema.insurance.organizationId,
          organizationId,
          eq(schema.insurance.id, id)
        )
      )
      .returning();
    if (!updated[0]) throw new SaludError("not_found", "Obra social no encontrada");
    return updated[0];
  } catch (err) {
    if (isUnique(err)) throw new SaludError("conflict", "Ya existe esa obra social");
    throw err;
  }
}

export async function deleteInsurance(
  organizationId: string,
  id: string
): Promise<void> {
  const deleted = await getDb()
    .delete(schema.insurance)
    .where(
      scoped(
        schema.insurance.organizationId,
        organizationId,
        eq(schema.insurance.id, id)
      )
    )
    .returning({ id: schema.insurance.id });
  if (!deleted[0]) throw new SaludError("not_found", "Obra social no encontrada");
}

function isUnique(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/* ------------------------------ lo que ve el agente ------------------------------ */

export type CatalogForAgent = {
  professionals: {
    id: string;
    name: string;
    specialty: string | null;
    appointmentTypeIds: string[];
    insurances: { name: string; copay: string | null }[];
  }[];
  appointmentTypes: {
    id: string;
    name: string;
    durationMinutes: number;
    price: number | null;
    prepNotes: string | null;
    depositAmount: number | null;
  }[];
  insurances: { id: string; name: string; notes: string | null }[];
};

/**
 * Solo lo activo y solo lo que el agente puede decirle a un paciente. Lo que
 * no está acá, el agente no lo sabe — y no lo inventa.
 */
export async function getCatalogForAgent(
  organizationId: string
): Promise<CatalogForAgent> {
  const [pros, types, ins] = await Promise.all([
    listProfessionals(organizationId, { onlyActive: true }),
    listAppointmentTypes(organizationId, { onlyActive: true }),
    listInsurances(organizationId, { onlyActive: true }),
  ]);
  const insName = new Map(ins.map((i) => [i.id, i.name]));
  const activeTypeIds = new Set(types.map((t) => t.id));
  return {
    professionals: pros.map((p) => ({
      id: p.id,
      name: p.name,
      specialty: p.specialty,
      appointmentTypeIds: p.appointmentTypeIds.filter((t) => activeTypeIds.has(t)),
      insurances: p.insurances
        .filter((i) => insName.has(i.insuranceId))
        .map((i) => ({ name: insName.get(i.insuranceId)!, copay: i.copay })),
    })),
    appointmentTypes: types.map((t) => ({
      id: t.id,
      name: t.name,
      durationMinutes: t.durationMinutes,
      price: t.price,
      prepNotes: t.prepNotes,
      depositAmount: t.depositAmount,
    })),
    insurances: ins.map((i) => ({ id: i.id, name: i.name, notes: i.notes })),
  };
}

/** ¿Hay profesionales activos? Sin ellos la agenda es la de siempre. */
export async function hasActiveProfessionals(
  organizationId: string
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.professional.id })
    .from(schema.professional)
    .where(
      scoped(
        schema.professional.organizationId,
        organizationId,
        and(eq(schema.professional.active, true))
      )
    )
    .limit(1);
  return rows.length > 0;
}
