import { and, desc, eq, gte, isNotNull, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { sendProactive } from "@/server/salud/messaging";
import { getHealthSettings } from "@/server/salud/settings";
import { firstName } from "@/server/salud/waitlist";

/**
 * 070 — Encuesta post-turno: un mensaje simple unas horas después de la cita.
 * El paciente contesta un número del 1 al 5 y, si fue 4 o 5 y el negocio cargó
 * su link de Google, se le pide la reseña. Si fue bajo, se le avisa al equipo
 * (queda guardado en la cita) en vez de pedirle reseña.
 */

/** PURA: ¿ya toca mandar la encuesta de esta cita? */
export function surveyDue(input: {
  scheduledAt: Date;
  durationMinutes: number;
  delayHours: number;
  surveySentAt: Date | null;
  now: Date;
}): boolean {
  if (input.surveySentAt) return false;
  const end = input.scheduledAt.getTime() + input.durationMinutes * 60_000;
  const due = end + input.delayHours * 3_600_000;
  // Pasadas 48 h desde que correspondía, ya no tiene sentido preguntar.
  return input.now.getTime() >= due && input.now.getTime() <= due + 48 * 3_600_000;
}

/** PURA: el puntaje que dijo el paciente, o null si no se entiende. */
export function parseScore(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

export function surveyText(name: string, professionalName: string | null): string {
  const quien = professionalName ? ` con ${professionalName}` : "";
  const saludo = name ? `Hola ${name}! ` : "Hola! ";
  return (
    `${saludo}¿Cómo te fue en tu turno${quien}? ` +
    `Contestame con un número del 1 (muy mal) al 5 (excelente). Tu opinión nos ayuda a mejorar.`
  );
}

export async function sweepSurveys(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({
      booking: schema.booking,
      contactName: schema.contact.name,
      professionalName: schema.professional.name,
    })
    .from(schema.booking)
    .innerJoin(schema.contact, eq(schema.booking.contactId, schema.contact.id))
    .leftJoin(
      schema.professional,
      eq(schema.booking.professionalId, schema.professional.id)
    )
    .where(
      and(
        eq(schema.booking.kind, "session"),
        eq(schema.booking.isTest, false),
        isNull(schema.booking.surveySentAt),
        isNotNull(schema.booking.conversationId),
        // El que faltó o canceló no recibe una encuesta de «cómo te fue».
        ne(schema.booking.status, "cancelada"),
        ne(schema.booking.status, "no_show"),
        ne(schema.booking.confirmation, "cancelada_paciente"),
        gte(schema.booking.scheduledAt, new Date(now.getTime() - 5 * 86_400_000))
      )
    )
    .limit(200);

  let sent = 0;
  const cache = new Map<string, Awaited<ReturnType<typeof getHealthSettings>>>();
  for (const r of rows) {
    const b = r.booking;
    let health = cache.get(b.organizationId);
    if (!health) {
      health = await getHealthSettings(b.organizationId);
      cache.set(b.organizationId, health);
    }
    if (!health.surveyEnabled) continue;
    if (
      !surveyDue({
        scheduledAt: b.scheduledAt,
        durationMinutes: b.durationMinutes,
        delayHours: health.surveyDelayHours,
        surveySentAt: b.surveySentAt,
        now,
      })
    )
      continue;
    // Se marca antes de enviar: un fallo no se vuelve un bucle de encuestas.
    const claimed = await db
      .update(schema.booking)
      .set({ surveySentAt: now })
      .where(and(eq(schema.booking.id, b.id), isNull(schema.booking.surveySentAt)))
      .returning({ id: schema.booking.id });
    if (claimed.length === 0) continue;
    const result = await sendProactive({
      organizationId: b.organizationId,
      conversationId: b.conversationId!,
      text: surveyText(firstName(r.contactName), r.professionalName),
      templateId: health.surveyTemplateId,
      templateVariables: [firstName(r.contactName), r.professionalName ?? ""],
    });
    if (result.sent) sent += 1;
  }
  return sent;
}

export type SurveyOutcome = {
  bookingId: string;
  score: number;
  /** Solo si el puntaje es alto y el negocio cargó el link. */
  reviewUrl: string | null;
};

/** Guarda la respuesta a la encuesta más reciente de la conversación. */
export async function recordSurvey(input: {
  organizationId: string;
  conversationId: string;
  score: number;
  comment?: string | null;
}): Promise<SurveyOutcome | null> {
  const db = getDb();
  const conv = await db
    .select({ contactId: schema.conversation.contactId })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  if (!conv[0]) return null;
  const pending = await db
    .select()
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        input.organizationId,
        and(
          eq(schema.booking.contactId, conv[0].contactId),
          isNotNull(schema.booking.surveySentAt),
          isNull(schema.booking.surveyScore)
        )
      )
    )
    .orderBy(desc(schema.booking.surveySentAt))
    .limit(1);
  const b = pending[0];
  if (!b) return null;
  await db
    .update(schema.booking)
    .set({
      surveyScore: input.score,
      surveyComment: input.comment?.trim().slice(0, 1000) || null,
      updatedAt: new Date(),
    })
    .where(eq(schema.booking.id, b.id));
  const health = await getHealthSettings(input.organizationId);
  return {
    bookingId: b.id,
    score: input.score,
    reviewUrl: input.score >= 4 ? health.reviewUrl : null,
  };
}

