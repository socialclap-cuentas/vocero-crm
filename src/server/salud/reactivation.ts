import { and, eq, gt, inArray, max } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { sendProactive } from "@/server/salud/messaging";
import { getHealthSettings } from "@/server/salud/settings";
import { firstName } from "@/server/salud/waitlist";

/**
 * 070 — Reactivación de pacientes: «hace 6 meses que no venís, ¿agendamos tu
 * control?». Un solo aviso por visita, sin insistir, y respetando a quien pidió
 * no recibir seguimientos.
 */

/** PURA: ¿corresponde reactivar a este paciente? */
export function reactivationDue(input: {
  lastVisitAt: Date;
  months: number;
  reactivationSentAt: Date | null;
  optOut: boolean;
  hasFutureBooking: boolean;
  now: Date;
}): boolean {
  if (input.optOut || input.hasFutureBooking) return false;
  const threshold = new Date(input.lastVisitAt);
  threshold.setUTCMonth(threshold.getUTCMonth() + input.months);
  if (input.now.getTime() < threshold.getTime()) return false;
  // Ya se le avisó DESPUÉS de su última visita: no se insiste.
  if (
    input.reactivationSentAt &&
    input.reactivationSentAt.getTime() > input.lastVisitAt.getTime()
  ) {
    return false;
  }
  return true;
}

export function reactivationText(name: string, months: number): string {
  const saludo = name ? `Hola ${name}! ` : "Hola! ";
  const hace = months === 12 ? "un año" : `${months} meses`;
  return (
    `${saludo}Hace ${hace} que no nos visitás y ya toca tu control. ` +
    `¿Querés que te busque un turno? Respondé *sí* y te paso los horarios disponibles.`
  );
}

const POR_BARRIDO = 20;

export async function sweepReactivation(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const orgs = await db
    .select({ organizationId: schema.healthSettings.organizationId })
    .from(schema.healthSettings)
    .where(eq(schema.healthSettings.reactivationEnabled, true));
  let sent = 0;

  for (const { organizationId } of orgs) {
    if (sent >= POR_BARRIDO) break;
    const health = await getHealthSettings(organizationId);
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
    if (last.length === 0) continue;

    const contactIds = last.map((l) => l.contactId!).filter(Boolean);
    const future = await db
      .select({ contactId: schema.booking.contactId })
      .from(schema.booking)
      .where(
        and(
          eq(schema.booking.organizationId, organizationId),
          eq(schema.booking.status, "agendada"),
          gt(schema.booking.scheduledAt, now),
          inArray(schema.booking.contactId, contactIds)
        )
      );
    const futureSet = new Set(future.map((f) => f.contactId));
    const profiles = await db
      .select()
      .from(schema.patientProfile)
      .where(inArray(schema.patientProfile.contactId, contactIds));
    const profileBy = new Map(profiles.map((p) => [p.contactId, p]));

    for (const l of last) {
      if (sent >= POR_BARRIDO) break;
      if (!l.contactId || !l.lastVisitAt) continue;
      const profile = profileBy.get(l.contactId);
      if (
        !reactivationDue({
          lastVisitAt: l.lastVisitAt,
          months: health.reactivationMonths,
          reactivationSentAt: profile?.reactivationSentAt ?? null,
          optOut: profile?.optOutFollowups ?? false,
          hasFutureBooking: futureSet.has(l.contactId),
          now,
        })
      )
        continue;

      const conv = await db
        .select({ id: schema.conversation.id })
        .from(schema.conversation)
        .where(
          scoped(
            schema.conversation.organizationId,
            organizationId,
            and(
              eq(schema.conversation.contactId, l.contactId),
              eq(schema.conversation.isTest, false)
            )
          )
        )
        .limit(1);
      const contact = await db
        .select({ name: schema.contact.name })
        .from(schema.contact)
        .where(eq(schema.contact.id, l.contactId))
        .limit(1);
      if (!conv[0]) continue;

      // Se marca antes de enviar: sin bucles si el envío falla.
      await db
        .insert(schema.patientProfile)
        .values({
          id: newId("patientProfile"),
          organizationId,
          contactId: l.contactId,
          reactivationSentAt: now,
        })
        .onConflictDoUpdate({
          target: schema.patientProfile.contactId,
          set: { reactivationSentAt: now, updatedAt: now },
        });
      const name = firstName(contact[0]?.name ?? "");
      const result = await sendProactive({
        organizationId,
        conversationId: conv[0].id,
        text: reactivationText(name, health.reactivationMonths),
        templateId: health.reactivationTemplateId,
        templateVariables: [name],
      });
      if (result.sent) sent += 1;
    }
  }
  return sent;
}
