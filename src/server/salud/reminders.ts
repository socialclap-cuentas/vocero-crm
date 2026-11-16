import { and, asc, eq, gt, gte, isNull, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { labelInTz } from "@/lib/time/slots";
import { getSettings } from "@/server/agenda/settings";
import { cancelBooking } from "@/server/agenda/service";
import { publish } from "@/server/events/bus";
import { sendProactive } from "@/server/salud/messaging";
import { getHealthSettings, type HealthSettings } from "@/server/salud/settings";
import { firstName } from "@/server/salud/waitlist";

/**
 * 070 — Recordatorios con confirmación.
 *
 * `reminderLeadHours` es p. ej. [48, 2]: un aviso a las 48 h y otro a las 2 h.
 * El paciente contesta «confirmo», «cancelo» o «reprogramo» y el agente lo
 * resuelve con las herramientas de abajo (el CRM no interpreta texto libre:
 * esa lectura es del agente, que ya entiende «ahí estaré» o «no llego»).
 */

export type ReminderPlan = {
  /** Cuál mandar ahora, o null. */
  send: "first" | "second" | null;
  /** Los avisos que ya no tiene sentido mandar (pasaron o se reservó adentro de la ventana). */
  skip: ("first" | "second")[];
};

/**
 * PURA: qué hacer con una cita en este instante.
 *
 *  - Un aviso se manda cuando llegó su hora y la cita todavía no pasó.
 *  - Si la cita se reservó DENTRO de la ventana de un aviso (reservó hoy para
 *    mañana y el primero era a las 48 h) ese aviso se descarta: mandar «te
 *    recordamos tu turno» un minuto después de reservar es ruido.
 *  - Si llegaron a la vez dos avisos (el servidor estuvo caído), se manda solo
 *    el último: nunca dos mensajes seguidos.
 */
export function planReminders(input: {
  scheduledAt: Date;
  createdAt: Date;
  reminderFirstAt: Date | null;
  reminderSecondAt: Date | null;
  leadHours: number[];
  now: Date;
}): ReminderPlan {
  const { scheduledAt, createdAt, now } = input;
  const plan: ReminderPlan = { send: null, skip: [] };
  if (scheduledAt.getTime() <= now.getTime()) return plan;

  const hours = input.leadHours;
  const slots: { key: "first" | "second"; hours: number; done: boolean }[] = [];
  if (hours[0] !== undefined)
    slots.push({ key: "first", hours: hours[0], done: input.reminderFirstAt !== null });
  if (hours[1] !== undefined)
    slots.push({ key: "second", hours: hours[1], done: input.reminderSecondAt !== null });

  const due = slots.filter((s) => {
    if (s.done) return false;
    const at = scheduledAt.getTime() - s.hours * 3_600_000;
    return now.getTime() >= at;
  });
  if (due.length === 0) return plan;

  const live = due.filter((s) => {
    const at = scheduledAt.getTime() - s.hours * 3_600_000;
    // Reservada dentro de la ventana de este aviso: se descarta.
    return createdAt.getTime() < at;
  });
  const discarded = due.filter((s) => !live.includes(s));
  plan.skip.push(...discarded.map((s) => s.key));

  if (live.length === 0) return plan;
  // El más cercano a la cita es el que vale; los demás vencidos se saltan.
  const last = live[live.length - 1]!;
  plan.send = last.key;
  plan.skip.push(...live.filter((s) => s !== last).map((s) => s.key));
  return plan;
}

export function reminderText(input: {
  name: string;
  label: string;
  professionalName: string | null;
  typeName: string | null;
  prepNotes: string | null;
  depositPending: number | null;
  depositPaymentInfo: string | null;
  isLast: boolean;
}): string {
  const quien = input.professionalName ? ` con ${input.professionalName}` : "";
  const que = input.typeName ? ` (${input.typeName})` : "";
  const saludo = input.name ? `Hola ${input.name}! ` : "Hola! ";
  const lines = [
    `${saludo}Te recordamos tu turno${quien}${que}: ${input.label}.`,
  ];
  if (input.prepNotes) lines.push(`Para ese día: ${input.prepNotes}`);
  if (input.depositPending && input.depositPaymentInfo) {
    lines.push(
      `Para dejarlo confirmado falta la seña de $${input.depositPending.toLocaleString("es-AR")}: ${input.depositPaymentInfo}`
    );
  }
  lines.push(
    input.isLast
      ? "Respondé *confirmo* si venís, o *cancelo* si no podés, así liberamos el horario."
      : "¿Confirmás tu asistencia? Respondé *confirmo*, *cancelo* o *reprogramo*."
  );
  return lines.join("\n");
}

type Row = {
  booking: typeof schema.booking.$inferSelect;
  contactName: string;
  professionalName: string | null;
  typeName: string | null;
  prepNotes: string | null;
};

async function candidates(now: Date, horizonHours: number): Promise<Row[]> {
  const until = new Date(now.getTime() + horizonHours * 3_600_000);
  return getDb()
    .select({
      booking: schema.booking,
      contactName: schema.contact.name,
      professionalName: schema.professional.name,
      typeName: schema.appointmentType.name,
      prepNotes: schema.appointmentType.prepNotes,
    })
    .from(schema.booking)
    .innerJoin(schema.contact, eq(schema.booking.contactId, schema.contact.id))
    .leftJoin(
      schema.professional,
      eq(schema.booking.professionalId, schema.professional.id)
    )
    .leftJoin(
      schema.appointmentType,
      eq(schema.booking.appointmentTypeId, schema.appointmentType.id)
    )
    .where(
      and(
        eq(schema.booking.kind, "session"),
        eq(schema.booking.status, "agendada"),
        eq(schema.booking.isTest, false),
        ne(schema.booking.confirmation, "cancelada_paciente"),
        gt(schema.booking.scheduledAt, now),
        lte(schema.booking.scheduledAt, until)
      )
    )
    .orderBy(asc(schema.booking.scheduledAt))
    .limit(200);
}

/** Barrido (cada minuto). Devuelve cuántos recordatorios envió. */
export async function sweepReminders(now: Date = new Date()): Promise<number> {
  const db = getDb();
  // Organizaciones con citas por venir: cada una con sus propias horas.
  const rows = await candidates(now, 24 * 14);
  if (rows.length === 0) return 0;

  const healthByOrg = new Map<string, HealthSettings>();
  const tzByOrg = new Map<string, string>();
  let sent = 0;

  for (const r of rows) {
    const b = r.booking;
    if (!b.conversationId) continue;
    let health = healthByOrg.get(b.organizationId);
    if (!health) {
      health = await getHealthSettings(b.organizationId);
      healthByOrg.set(b.organizationId, health);
    }
    let tz = tzByOrg.get(b.organizationId);
    if (!tz) {
      tz = (await getSettings(b.organizationId)).timezone;
      tzByOrg.set(b.organizationId, tz);
    }
    const plan = planReminders({
      scheduledAt: b.scheduledAt,
      createdAt: b.createdAt,
      reminderFirstAt: b.reminderFirstAt,
      reminderSecondAt: b.reminderSecondAt,
      leadHours: health.reminderLeadHours,
      now,
    });
    if (plan.send === null && plan.skip.length === 0) continue;

    // Se marca ANTES de enviar: un fallo no puede convertirse en un bucle que
    // le mande el mismo recordatorio al paciente cada minuto.
    const set: Partial<typeof schema.booking.$inferInsert> = {};
    for (const k of [...plan.skip, ...(plan.send ? [plan.send] : [])]) {
      if (k === "first") set.reminderFirstAt = now;
      else set.reminderSecondAt = now;
    }
    const claimed = await db
      .update(schema.booking)
      .set(set)
      .where(
        and(
          eq(schema.booking.id, b.id),
          plan.send === "first"
            ? isNull(schema.booking.reminderFirstAt)
            : plan.send === "second"
              ? isNull(schema.booking.reminderSecondAt)
              : undefined
        )
      )
      .returning({ id: schema.booking.id });
    if (claimed.length === 0 || plan.send === null) continue;

    const label = labelInTz(b.scheduledAt.toISOString(), tz);
    const text = reminderText({
      name: firstName(r.contactName),
      label,
      professionalName: r.professionalName,
      typeName: r.typeName,
      prepNotes: r.prepNotes,
      depositPending:
        b.depositStatus === "pendiente" ? (b.depositAmount ?? null) : null,
      depositPaymentInfo: health.depositPaymentInfo,
      isLast: plan.send === "second",
    });
    const result = await sendProactive({
      organizationId: b.organizationId,
      conversationId: b.conversationId,
      text,
      templateId: health.reminderTemplateId,
      templateVariables: [firstName(r.contactName), label, r.professionalName ?? ""],
    });
    if (result.sent) {
      sent += 1;
    } else {
      console.warn(
        `[salud] recordatorio de ${b.id} no salió: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`
      );
    }
  }
  return sent;
}

/* ----------------- respuestas del paciente (las usa el agente) ----------------- */

export class ReminderError extends Error {
  constructor(
    public code: "not_found" | "invalid",
    message: string
  ) {
    super(message);
    this.name = "ReminderError";
  }
}

/** La próxima cita activa de la conversación (la que el aviso nombra). */
export async function nextBookingForConversation(
  organizationId: string,
  conversationId: string,
  now: Date = new Date()
) {
  const conv = await getDb()
    .select({ contactId: schema.conversation.contactId })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  if (!conv[0]) throw new ReminderError("not_found", "Conversación no encontrada");
  const rows = await getDb()
    .select()
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          eq(schema.booking.contactId, conv[0].contactId),
          eq(schema.booking.kind, "session"),
          eq(schema.booking.status, "agendada"),
          gte(schema.booking.scheduledAt, now)
        )
      )
    )
    .orderBy(asc(schema.booking.scheduledAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function confirmNextBooking(input: {
  organizationId: string;
  conversationId: string;
  now?: Date;
}) {
  const b = await nextBookingForConversation(
    input.organizationId,
    input.conversationId,
    input.now
  );
  if (!b) throw new ReminderError("not_found", "No hay una cita por confirmar");
  const upd = await getDb()
    .update(schema.booking)
    .set({
      confirmation: "confirmada",
      confirmedAt: input.now ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.booking.id, b.id))
    .returning();
  publish(input.organizationId, {
    type: "booking.updated",
    data: { bookingId: b.id },
  });
  return upd[0]!;
}

/** El paciente cancela respondiendo el aviso: la cita se libera y la espera se activa. */
export async function cancelNextBookingByPatient(input: {
  organizationId: string;
  conversationId: string;
  now?: Date;
}) {
  const b = await nextBookingForConversation(
    input.organizationId,
    input.conversationId,
    input.now
  );
  if (!b) throw new ReminderError("not_found", "No hay una cita para cancelar");
  await getDb()
    .update(schema.booking)
    .set({ confirmation: "cancelada_paciente", updatedAt: new Date() })
    .where(eq(schema.booking.id, b.id));
  // cancelBooking libera el hueco, borra la reunión y avisa a la lista de espera.
  await cancelBooking({
    organizationId: input.organizationId,
    bookingId: b.id,
  });
  return b;
}
