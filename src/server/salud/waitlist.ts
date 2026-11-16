import { and, asc, eq, isNull, lt, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { labelInTz } from "@/lib/time/slots";
import { replaceOffers } from "@/server/agenda/offers";
import { getSettings } from "@/server/agenda/settings";
import { getHealthSettings } from "@/server/salud/settings";
import { sendProactive } from "@/server/salud/messaging";

/**
 * 070 — Lista de espera.
 *
 * Cuando una cita se cancela, el hueco se le ofrece a quien esperaba, de a
 * UNO por vez (el que lleva más tiempo esperando). La oferta se registra en
 * `offered_slot` de su conversación: si contesta «sí», el agente reserva ese
 * hueco por el camino de siempre. Si no contesta en `OFFER_TTL_MIN`, el
 * barrido se lo ofrece al siguiente.
 */

export const OFFER_TTL_MIN = 30;

export type WaitlistRow = typeof schema.waitlistEntry.$inferSelect;
type BookingRow = typeof schema.booking.$inferSelect;

export async function joinWaitlist(input: {
  organizationId: string;
  contactId: string;
  conversationId?: string | null;
  professionalId?: string | null;
  appointmentTypeId?: string | null;
  preferences?: string | null;
}): Promise<WaitlistRow> {
  const db = getDb();
  // Una sola entrada activa por contacto y profesional: anotarse dos veces no
  // lo adelanta ni le manda dos avisos.
  const existing = await db
    .select()
    .from(schema.waitlistEntry)
    .where(
      scoped(
        schema.waitlistEntry.organizationId,
        input.organizationId,
        and(
          eq(schema.waitlistEntry.contactId, input.contactId),
          input.professionalId
            ? eq(schema.waitlistEntry.professionalId, input.professionalId)
            : isNull(schema.waitlistEntry.professionalId),
          or(
            eq(schema.waitlistEntry.status, "waiting"),
            eq(schema.waitlistEntry.status, "offered")
          )
        )
      )
    )
    .limit(1);
  if (existing[0]) {
    const upd = await db
      .update(schema.waitlistEntry)
      .set({
        preferences: input.preferences?.trim() || existing[0].preferences,
        appointmentTypeId:
          input.appointmentTypeId ?? existing[0].appointmentTypeId,
      })
      .where(eq(schema.waitlistEntry.id, existing[0].id))
      .returning();
    return upd[0]!;
  }
  const inserted = await db
    .insert(schema.waitlistEntry)
    .values({
      id: newId("waitlistEntry"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId ?? null,
      professionalId: input.professionalId ?? null,
      appointmentTypeId: input.appointmentTypeId ?? null,
      preferences: input.preferences?.trim() || null,
    })
    .returning();
  return inserted[0]!;
}

export async function listWaitlist(
  organizationId: string,
  opts?: { status?: WaitlistRow["status"] }
) {
  return getDb()
    .select({
      entry: schema.waitlistEntry,
      contactName: schema.contact.name,
    })
    .from(schema.waitlistEntry)
    .innerJoin(
      schema.contact,
      eq(schema.waitlistEntry.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.waitlistEntry.organizationId,
        organizationId,
        opts?.status ? eq(schema.waitlistEntry.status, opts.status) : undefined
      )
    )
    .orderBy(asc(schema.waitlistEntry.createdAt));
}

export async function cancelWaitlistEntry(
  organizationId: string,
  id: string
): Promise<boolean> {
  const upd = await getDb()
    .update(schema.waitlistEntry)
    .set({ status: "cancelled" })
    .where(
      scoped(
        schema.waitlistEntry.organizationId,
        organizationId,
        eq(schema.waitlistEntry.id, id)
      )
    )
    .returning({ id: schema.waitlistEntry.id });
  return upd.length > 0;
}

/** PURA: ¿esta entrada puede recibir este hueco? */
export function entryMatchesSlot(
  entry: Pick<
    WaitlistRow,
    "professionalId" | "appointmentTypeId" | "offeredStartUtc"
  >,
  slot: { professionalId: string | null; appointmentTypeId: string | null; startUtc: Date }
): boolean {
  // Ya se le ofreció este mismo hueco y no lo tomó: pasa al siguiente.
  if (
    entry.offeredStartUtc &&
    entry.offeredStartUtc.getTime() === slot.startUtc.getTime()
  ) {
    return false;
  }
  if (entry.professionalId && entry.professionalId !== slot.professionalId) {
    return false;
  }
  if (
    entry.appointmentTypeId &&
    slot.appointmentTypeId &&
    entry.appointmentTypeId !== slot.appointmentTypeId
  ) {
    return false;
  }
  return true;
}

export function waitlistOfferText(input: {
  name: string;
  label: string;
  professionalName: string | null;
}): string {
  const con = input.professionalName ? ` con ${input.professionalName}` : "";
  return (
    `Hola ${input.name}! Se liberó un turno${con}: ${input.label}. ` +
    `¿Lo querés? Respondé SÍ y te lo reservo ahora; si no, lo ofrezco a otra persona en unos minutos.`
  );
}

/** Se llama cuando una cita se cancela: ofrece el hueco al primero que espera. */
export async function onSlotFreed(
  organizationId: string,
  booking: BookingRow,
  now: Date = new Date()
): Promise<{ offeredTo: string | null }> {
  if (booking.scheduledAt.getTime() <= now.getTime()) return { offeredTo: null };
  const health = await getHealthSettings(organizationId);
  if (!health.waitlistEnabled) return { offeredTo: null };
  return offerSlotToNext(organizationId, {
    professionalId: booking.professionalId,
    appointmentTypeId: booking.appointmentTypeId,
    startUtc: booking.scheduledAt,
  }, now);
}

async function offerSlotToNext(
  organizationId: string,
  slot: {
    professionalId: string | null;
    appointmentTypeId: string | null;
    startUtc: Date;
  },
  now: Date
): Promise<{ offeredTo: string | null }> {
  const db = getDb();
  const waiting = await db
    .select({
      entry: schema.waitlistEntry,
      contactName: schema.contact.name,
    })
    .from(schema.waitlistEntry)
    .innerJoin(
      schema.contact,
      eq(schema.waitlistEntry.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.waitlistEntry.organizationId,
        organizationId,
        eq(schema.waitlistEntry.status, "waiting")
      )
    )
    .orderBy(asc(schema.waitlistEntry.createdAt));

  const candidate = waiting.find(
    (w) => w.entry.conversationId && entryMatchesSlot(w.entry, slot)
  );
  if (!candidate) return { offeredTo: null };

  const settings = await getSettings(organizationId);
  const label = labelInTz(slot.startUtc.toISOString(), settings.timezone);
  let professionalName: string | null = null;
  if (slot.professionalId) {
    const p = await db
      .select({ name: schema.professional.name })
      .from(schema.professional)
      .where(eq(schema.professional.id, slot.professionalId))
      .limit(1);
    professionalName = p[0]?.name ?? null;
  }

  // La oferta queda registrada ANTES de avisar: si contesta de inmediato, el
  // agente ya puede reservar ese hueco.
  await replaceOffers(organizationId, candidate.entry.conversationId!, [
    {
      startUtc: slot.startUtc.toISOString(),
      label,
      professionalId: slot.professionalId,
      appointmentTypeId: slot.appointmentTypeId,
    },
  ]);
  await db
    .update(schema.waitlistEntry)
    .set({
      status: "offered",
      offeredStartUtc: slot.startUtc,
      offeredAt: now,
    })
    .where(eq(schema.waitlistEntry.id, candidate.entry.id));

  const health = await getHealthSettings(organizationId);
  const result = await sendProactive({
    organizationId,
    conversationId: candidate.entry.conversationId!,
    text: waitlistOfferText({
      name: firstName(candidate.contactName),
      label,
      professionalName,
    }),
    templateId: health.reminderTemplateId,
    templateVariables: [firstName(candidate.contactName), label, professionalName ?? ""],
  });
  if (!result.sent) {
    // No se pudo avisar (ventana cerrada sin plantilla): vuelve a la cola sin
    // quedarse «ofrecida» en falso, y se marca el hueco para no insistir.
    await db
      .update(schema.waitlistEntry)
      .set({ status: "waiting", offeredAt: null })
      .where(eq(schema.waitlistEntry.id, candidate.entry.id));
    return { offeredTo: null };
  }
  return { offeredTo: candidate.entry.contactId };
}

export function firstName(full: string): string {
  const t = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return t.length > 0 ? t : "";
}

/**
 * Barrido (cada minuto): una oferta sin respuesta pasa al siguiente.
 * Devuelve cuántas ofertas venció.
 */
export async function sweepWaitlist(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - OFFER_TTL_MIN * 60_000);
  const stale = await db
    .select()
    .from(schema.waitlistEntry)
    .where(
      and(
        eq(schema.waitlistEntry.status, "offered"),
        lt(schema.waitlistEntry.offeredAt, cutoff)
      )
    );
  let n = 0;
  for (const e of stale) {
    // Vuelve a esperar (conservando offeredStartUtc: no se le re-ofrece ese hueco).
    await db
      .update(schema.waitlistEntry)
      .set({ status: "waiting", offeredAt: null })
      .where(eq(schema.waitlistEntry.id, e.id));
    n += 1;
    if (e.offeredStartUtc && e.offeredStartUtc.getTime() > now.getTime()) {
      // ¿El hueco sigue libre? Si ya lo ocupó otra cita, no hay qué ofrecer.
      const taken = await db
        .select({ id: schema.booking.id })
        .from(schema.booking)
        .where(
          and(
            eq(schema.booking.organizationId, e.organizationId),
            eq(schema.booking.scheduledAt, e.offeredStartUtc),
            ne(schema.booking.status, "cancelada"),
            ne(schema.booking.status, "no_show"),
            eq(schema.booking.isTest, false),
            e.professionalId
              ? eq(schema.booking.professionalId, e.professionalId)
              : undefined
          )
        )
        .limit(1);
      if (taken.length === 0) {
        await offerSlotToNext(
          e.organizationId,
          {
            professionalId: e.professionalId,
            appointmentTypeId: e.appointmentTypeId,
            startUtc: e.offeredStartUtc,
          },
          now
        ).catch((err) => console.warn(`[salud] re-oferta falló: ${err}`));
      }
    }
  }
  return n;
}

/** Al reservar un paciente que esperaba, su entrada pasa a «booked». */
export async function markWaitlistBooked(
  organizationId: string,
  contactId: string
): Promise<void> {
  await getDb()
    .update(schema.waitlistEntry)
    .set({ status: "booked" })
    .where(
      scoped(
        schema.waitlistEntry.organizationId,
        organizationId,
        and(
          eq(schema.waitlistEntry.contactId, contactId),
          or(
            eq(schema.waitlistEntry.status, "waiting"),
            eq(schema.waitlistEntry.status, "offered")
          )
        )
      )
    );
}
