import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { SaludError } from "@/server/salud/catalog";

/**
 * 070 — Ficha ADMINISTRATIVA del paciente. No es historia clínica: guarda lo
 * que un consultorio necesita para agendar y cobrar (documento, obra social,
 * afiliado, nota del equipo). Los datos clínicos viven en el sistema del
 * profesional (Ley 26.529 / datos sensibles Ley 25.326).
 */

export type PatientDto = {
  contactId: string;
  documentNumber: string | null;
  birthDate: string | null;
  insuranceId: string | null;
  affiliateNumber: string | null;
  adminNotes: string | null;
  optOutFollowups: boolean;
  reactivationSentAt: string | null;
};

export type PatientInput = {
  documentNumber?: string | null;
  birthDate?: string | null;
  insuranceId?: string | null;
  affiliateNumber?: string | null;
  adminNotes?: string | null;
  optOutFollowups?: boolean;
};

/** PURA: DNI/documento — solo dígitos y puntos/guiones comunes, 5 a 14 caracteres. */
export function normalizeDocument(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/[.\s-]/g, "");
  if (t.length === 0) return null;
  if (!/^[A-Za-z0-9]{5,14}$/.test(t)) {
    throw new SaludError("invalid", "Documento inválido");
  }
  return t;
}

/** PURA: AAAA-MM-DD real, no futura, no anterior a 1900. */
export function normalizeBirthDate(
  v: string | null | undefined,
  now: Date = new Date()
): string | null {
  const t = (v ?? "").trim();
  if (t.length === 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new SaludError("invalid", "La fecha de nacimiento debe ser AAAA-MM-DD");
  }
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) {
    throw new SaludError("invalid", "Fecha de nacimiento inexistente");
  }
  if (t < "1900-01-01" || d.getTime() > now.getTime()) {
    throw new SaludError("invalid", "Fecha de nacimiento fuera de rango");
  }
  return t;
}

function clean(v: string | null | undefined, max: number): string | null {
  const t = (v ?? "").trim().slice(0, max);
  return t.length > 0 ? t : null;
}

function toDto(contactId: string, r?: typeof schema.patientProfile.$inferSelect): PatientDto {
  return {
    contactId,
    documentNumber: r?.documentNumber ?? null,
    birthDate: r?.birthDate ?? null,
    insuranceId: r?.insuranceId ?? null,
    affiliateNumber: r?.affiliateNumber ?? null,
    adminNotes: r?.adminNotes ?? null,
    optOutFollowups: r?.optOutFollowups ?? false,
    reactivationSentAt: r?.reactivationSentAt?.toISOString() ?? null,
  };
}

async function assertContact(organizationId: string, contactId: string) {
  const rows = await getDb()
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  if (!rows[0]) throw new SaludError("not_found", "Contacto no encontrado");
}

export async function getPatient(
  organizationId: string,
  contactId: string
): Promise<PatientDto> {
  await assertContact(organizationId, contactId);
  const rows = await getDb()
    .select()
    .from(schema.patientProfile)
    .where(
      scoped(
        schema.patientProfile.organizationId,
        organizationId,
        eq(schema.patientProfile.contactId, contactId)
      )
    )
    .limit(1);
  return toDto(contactId, rows[0]);
}

export async function upsertPatient(
  organizationId: string,
  contactId: string,
  input: PatientInput,
  now: Date = new Date()
): Promise<PatientDto> {
  await assertContact(organizationId, contactId);
  const db = getDb();

  if (input.insuranceId) {
    const ins = await db
      .select({ id: schema.insurance.id })
      .from(schema.insurance)
      .where(
        scoped(
          schema.insurance.organizationId,
          organizationId,
          eq(schema.insurance.id, input.insuranceId)
        )
      )
      .limit(1);
    if (!ins[0]) throw new SaludError("invalid", "Obra social inexistente");
  }

  const set: Partial<typeof schema.patientProfile.$inferInsert> = {
    updatedAt: now,
  };
  if (input.documentNumber !== undefined)
    set.documentNumber = normalizeDocument(input.documentNumber);
  if (input.birthDate !== undefined)
    set.birthDate = normalizeBirthDate(input.birthDate, now);
  if (input.insuranceId !== undefined) set.insuranceId = input.insuranceId;
  if (input.affiliateNumber !== undefined)
    set.affiliateNumber = clean(input.affiliateNumber, 40);
  if (input.adminNotes !== undefined) set.adminNotes = clean(input.adminNotes, 2000);
  if (input.optOutFollowups !== undefined)
    set.optOutFollowups = input.optOutFollowups;

  const rows = await db
    .insert(schema.patientProfile)
    .values({
      id: newId("patientProfile"),
      organizationId,
      contactId,
      ...set,
    })
    .onConflictDoUpdate({ target: schema.patientProfile.contactId, set })
    .returning();
  return toDto(contactId, rows[0]);
}


/** Tope de la nota del contacto (el mismo del panel: `PUT /api/contacts/:id`). */
export const CONTACT_NOTES_MAX = 4000;
/** Tope de una línea que anota el agente: un dato suelto, no un párrafo. */
export const AGENT_NOTE_MAX = 200;

/**
 * PURA: suma una línea («• …») a las notas del contacto SIN pisar lo que ya
 * escribió el equipo. Repetida no se vuelve a anotar, y nunca pasa el tope.
 * Devuelve null si no hay nada que cambiar.
 */
export function appendContactNote(existing: string | null, line: string): string | null {
  const limpia = line.replace(/\s+/g, " ").trim().slice(0, AGENT_NOTE_MAX);
  if (!limpia) return null;
  const nueva = `• ${limpia}`;
  const actual = (existing ?? "").trimEnd();
  if (actual.split("\n").some((l) => l.trim().toLowerCase() === nueva.toLowerCase())) return null;
  const junto = actual ? `${actual}\n${nueva}` : nueva;
  return junto.length > CONTACT_NOTES_MAX ? null : junto;
}

/** El agente deja un dato EXTRA en las notas del contacto (append, idempotente). */
export async function addContactNote(
  organizationId: string,
  contactId: string,
  line: string
): Promise<{ saved: boolean }> {
  const db = getDb();
  const rows = await db
    .select({ notes: schema.contact.notes })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)))
    .limit(1);
  if (!rows[0]) throw new SaludError("not_found", "Contacto no encontrado");
  const next = appendContactNote(rows[0].notes, line);
  if (next === null) return { saved: false };
  await db
    .update(schema.contact)
    .set({ notes: next })
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)));
  return { saved: true };
}
