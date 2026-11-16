import { and, asc, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { labelInTz } from "@/lib/time/slots";
import { getSettings } from "@/server/agenda/settings";
import { getPatient, type PatientDto } from "@/server/salud/patient";

/**
 * 070 — Lo que el agente necesita saber de ESTE paciente para contestar bien:
 * su próximo turno con quién/para qué, si falta confirmarlo o la seña, si hay
 * una encuesta esperando respuesta y si lo está esperando un hueco.
 *
 * Va en `/api/bot/context` como bloque `salud`. FALTA si la instancia no tiene
 * profesionales cargados: un cerebro que no lo recibe se comporta como siempre.
 */

export type SaludContext = {
  nextBooking: {
    id: string;
    label: string;
    professional: { id: string; name: string } | null;
    appointmentType: { id: string; name: string; prepNotes: string | null } | null;
    confirmation: "pendiente" | "confirmada" | "cancelada_paciente";
    depositStatus: "no_aplica" | "pendiente" | "pagada";
    depositAmount: number | null;
    /** true ⇒ ya se le mandó al menos un recordatorio: lo que conteste probablemente responde a eso. */
    reminderSent: boolean;
  } | null;
  surveyPending: boolean;
  waitlist: {
    status: "waiting" | "offered";
    /** Si hay un hueco ofrecido, el agente puede reservarlo con la oferta vigente. */
    offeredLabel: string | null;
    /**
     * El hueco ofrecido, completo: el cerebro lo siembra en su propia memoria
     * de ofertas (si no, para él no sería reservable). Ausente sin oferta.
     */
    offered?: {
      startUtc: string;
      label: string;
      professionalId: string | null;
      professionalName: string | null;
      appointmentTypeId: string | null;
    };
  } | null;
  openUrgency: boolean;
  patient: PatientDto;
};

export async function contextoSalud(
  organizationId: string,
  contactId: string,
  now: Date = new Date()
): Promise<SaludContext | null> {
  const db = getDb();
  const any = await db
    .select({ id: schema.professional.id })
    .from(schema.professional)
    .where(scoped(schema.professional.organizationId, organizationId))
    .limit(1);
  if (any.length === 0) return null;

  const settings = await getSettings(organizationId);

  const nextRows = await db
    .select({
      booking: schema.booking,
      professionalName: schema.professional.name,
      typeName: schema.appointmentType.name,
      prepNotes: schema.appointmentType.prepNotes,
    })
    .from(schema.booking)
    .leftJoin(
      schema.professional,
      eq(schema.booking.professionalId, schema.professional.id)
    )
    .leftJoin(
      schema.appointmentType,
      eq(schema.booking.appointmentTypeId, schema.appointmentType.id)
    )
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          eq(schema.booking.contactId, contactId),
          eq(schema.booking.kind, "session"),
          eq(schema.booking.status, "agendada"),
          gte(schema.booking.scheduledAt, now)
        )
      )
    )
    .orderBy(asc(schema.booking.scheduledAt))
    .limit(1);
  const n = nextRows[0];

  const survey = await db
    .select({ id: schema.booking.id })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          eq(schema.booking.contactId, contactId),
          isNotNull(schema.booking.surveySentAt),
          isNull(schema.booking.surveyScore)
        )
      )
    )
    .orderBy(desc(schema.booking.surveySentAt))
    .limit(1);

  const wl = await db
    .select()
    .from(schema.waitlistEntry)
    .where(
      scoped(
        schema.waitlistEntry.organizationId,
        organizationId,
        eq(schema.waitlistEntry.contactId, contactId)
      )
    )
    .orderBy(desc(schema.waitlistEntry.createdAt))
    .limit(3);
  const activeWl = wl.find((w) => w.status === "waiting" || w.status === "offered");

  // El hueco que el CRM le ofreció desde la lista de espera, con su profesional.
  let offered: NonNullable<SaludContext["waitlist"]>["offered"];
  if (activeWl?.status === "offered" && activeWl.offeredStartUtc && activeWl.conversationId) {
    const rows = await db
      .select({
        startUtc: schema.offeredSlot.startUtc,
        label: schema.offeredSlot.label,
        professionalId: schema.offeredSlot.professionalId,
        appointmentTypeId: schema.offeredSlot.appointmentTypeId,
        professionalName: schema.professional.name,
      })
      .from(schema.offeredSlot)
      .leftJoin(
        schema.professional,
        eq(schema.offeredSlot.professionalId, schema.professional.id)
      )
      .where(
        scoped(
          schema.offeredSlot.organizationId,
          organizationId,
          eq(schema.offeredSlot.conversationId, activeWl.conversationId)
        )
      )
      .limit(5);
    const r = rows.find(
      (x) => x.startUtc.getTime() === activeWl.offeredStartUtc!.getTime()
    );
    if (r) {
      offered = {
        startUtc: r.startUtc.toISOString(),
        label: r.label,
        professionalId: r.professionalId,
        professionalName: r.professionalName,
        appointmentTypeId: r.appointmentTypeId,
      };
    }
  }

  const urgent = await db
    .select({ id: schema.triageEvent.id })
    .from(schema.triageEvent)
    .where(
      scoped(
        schema.triageEvent.organizationId,
        organizationId,
        and(
          eq(schema.triageEvent.contactId, contactId),
          isNull(schema.triageEvent.resolvedAt)
        )
      )
    )
    .limit(1);

  return {
    nextBooking: n
      ? {
          id: n.booking.id,
          label: labelInTz(n.booking.scheduledAt.toISOString(), settings.timezone),
          professional:
            n.booking.professionalId && n.professionalName
              ? { id: n.booking.professionalId, name: n.professionalName }
              : null,
          appointmentType:
            n.booking.appointmentTypeId && n.typeName
              ? {
                  id: n.booking.appointmentTypeId,
                  name: n.typeName,
                  prepNotes: n.prepNotes,
                }
              : null,
          confirmation: n.booking.confirmation,
          depositStatus: n.booking.depositStatus,
          depositAmount: n.booking.depositAmount,
          reminderSent:
            n.booking.reminderFirstAt !== null || n.booking.reminderSecondAt !== null,
        }
      : null,
    surveyPending: survey.length > 0,
    waitlist: activeWl
      ? {
          status: activeWl.status as "waiting" | "offered",
          offeredLabel:
            activeWl.status === "offered" && activeWl.offeredStartUtc
              ? labelInTz(activeWl.offeredStartUtc.toISOString(), settings.timezone)
              : null,
          ...(offered ? { offered } : {}),
        }
      : null,
    openUrgency: urgent.length > 0,
    patient: await getPatient(organizationId, contactId),
  };
}
