import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import {
  DEFAULT_URGENCY_MESSAGE,
  getHealthSettings,
} from "@/server/salud/settings";

/**
 * 070 — Triage de urgencias.
 *
 * Dos capas, a propósito:
 *
 *  1. El agente entiende el contexto («me duele mucho la muela hace tres días»
 *     no es lo mismo que «me desmayé») y llama a `recordTriage`.
 *  2. Una red DETERMINISTA, sin IA, mira cada mensaje entrante con palabras
 *     clave. Si el modelo falla, se pone terco o está pausado, una frase como
 *     «no puedo respirar» igual llega a una persona.
 *
 * Regla que no se negocia: ninguna de las dos capas diagnostica ni da
 * indicaciones médicas. Derivan a una persona y, si es vital, a emergencias.
 */

export type TriageLevel = "urgente" | "prioritario";

export type UrgencyMatch = { level: TriageLevel; reason: string };

/** Quita tildes, pasa a minúsculas y colapsa espacios: «Dolor  de PECHO» → «dolor de pecho». */
export function normalizeText(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Señales de riesgo vital: derivación inmediata. */
const URGENT: { re: RegExp; reason: string }[] = [
  { re: /\bdolor (fuerte |intenso |agudo )?(de|en el) (pecho|torax)\b/, reason: "dolor de pecho" },
  { re: /\b(no puedo|cuesta|dificultad para|falta de) (respirar|aire)\b/, reason: "dificultad para respirar" },
  { re: /\bme (ahogo|estoy ahogando)\b/, reason: "ahogo" },
  { re: /\b(me desmaye|se desmayo|desmayo|perdi el conocimiento|perdida de conocimiento|inconsciente)\b/, reason: "pérdida de conocimiento" },
  { re: /\b(convulsion|convulsiona|convulsiones|ataque epileptico)\b/, reason: "convulsión" },
  { re: /\b(hemorragia|sangrado (abundante|que no para|fuerte)|no para de sangrar|sangra mucho)\b/, reason: "sangrado abundante" },
  { re: /\b(infarto|acv|derrame cerebral)\b/, reason: "posible evento cardiovascular" },
  { re: /\b(reaccion alergica (grave|fuerte)|se me hincha (la garganta|la lengua)|anafilax)/, reason: "reacción alérgica grave" },
  { re: /\b(me quiero (morir|matar)|quiero morirme|quiero matarme|suicid)/, reason: "señal de riesgo vital" },
  { re: /\b(envenen|intoxicacion|me intoxique|tome de mas)\b/, reason: "posible intoxicación" },
];

/** Importantes pero no vitales: pasan al frente de la cola de una persona. */
const PRIORITY: { re: RegExp; reason: string }[] = [
  { re: /\b(urgencia|urgente|emergencia)\b/, reason: "el paciente dice que es urgente" },
  { re: /\bdolor (muy |re |super )?(fuerte|intenso|insoportable|terrible)\b/, reason: "dolor fuerte" },
  { re: /\bmucho dolor\b/, reason: "dolor fuerte" },
  { re: /\bfiebre (alta|de 39|de 40|que no baja)\b/, reason: "fiebre alta" },
  { re: /\b(cara|mejilla|ojo|cuello) (muy )?(hinchad|inflamad)/, reason: "inflamación en la cara o el cuello" },
  { re: /\b(se me (cayo|rompio|partio) (un |una |el |la )?(diente|muela|corona|protesis))\b/, reason: "pieza dental rota o caída" },
  { re: /\b(me golpee|tuve un accidente|me cai|golpe fuerte|accidente)\b/, reason: "golpe o accidente" },
  { re: /\b(pus|absceso|infeccion)\b/, reason: "posible infección" },
  { re: /\bno (puedo|aguanto) (mas|el dolor)\b/, reason: "dolor que no aguanta" },
  { re: /\bvomit(o|os|ando) (con sangre|sin parar)\b/, reason: "vómitos con sangre o persistentes" },
];

/**
 * PURA: ¿este mensaje suena a urgencia? `extraKeywords` son las palabras del
 * negocio (una por línea) y cuentan como prioritarias.
 *
 * Es CONSERVADORA en el sentido útil: prefiere un falso aviso a una persona
 * (que lo descarta con un clic) antes que pasar por alto una urgencia real.
 * Por eso, una negación simple («no tengo dolor de pecho») NO la desactiva:
 * lo decide la persona.
 */
export function detectUrgency(
  text: string | null | undefined,
  extraKeywords?: string | null
): UrgencyMatch | null {
  if (!text) return null;
  const t = normalizeText(text);
  if (t.length === 0) return null;
  for (const { re, reason } of URGENT) {
    if (re.test(t)) return { level: "urgente", reason };
  }
  for (const { re, reason } of PRIORITY) {
    if (re.test(t)) return { level: "prioritario", reason };
  }
  if (extraKeywords) {
    for (const line of extraKeywords.split("\n")) {
      const k = normalizeText(line);
      if (k.length >= 3 && t.includes(k)) {
        return { level: "prioritario", reason: `palabra del consultorio: ${line.trim()}` };
      }
    }
  }
  return null;
}

export type TriageEventRow = typeof schema.triageEvent.$inferSelect;

/**
 * Registra la urgencia y avisa a la bandeja. Con nivel `urgente` además pasa
 * la conversación a una persona (la IA deja de contestar).
 *
 * Idempotente por conversación: si ya hay una urgencia ABIERTA del mismo nivel
 * (o peor) no se duplica; si pasa de prioritaria a urgente, se escala.
 */
export async function recordTriage(input: {
  organizationId: string;
  conversationId: string;
  level: TriageLevel;
  reason: string;
}): Promise<{ event: TriageEventRow; created: boolean; message: string }> {
  const db = getDb();
  const convRows = await db
    .select({
      id: schema.conversation.id,
      contactId: schema.conversation.contactId,
      handoffAt: schema.conversation.handoffAt,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const conv = convRows[0];
  if (!conv) throw new Error("Conversación no encontrada");

  const reason = input.reason.trim().slice(0, 300) || "sin detalle";
  const open = await db
    .select()
    .from(schema.triageEvent)
    .where(
      scoped(
        schema.triageEvent.organizationId,
        input.organizationId,
        and(
          eq(schema.triageEvent.conversationId, conv.id),
          isNull(schema.triageEvent.resolvedAt)
        )
      )
    )
    .orderBy(desc(schema.triageEvent.createdAt))
    .limit(1);

  const health = await getHealthSettings(input.organizationId);
  const message = health.urgencyMessage ?? DEFAULT_URGENCY_MESSAGE;

  let event: TriageEventRow;
  let created = false;
  const prev = open[0];
  if (prev && (prev.level === "urgente" || input.level === "prioritario")) {
    event = prev;
  } else if (prev) {
    // prioritaria → urgente: se escala la misma alerta.
    const upd = await db
      .update(schema.triageEvent)
      .set({ level: "urgente", reason })
      .where(eq(schema.triageEvent.id, prev.id))
      .returning();
    event = upd[0]!;
  } else {
    const ins = await db
      .insert(schema.triageEvent)
      .values({
        id: newId("triageEvent"),
        organizationId: input.organizationId,
        contactId: conv.contactId,
        conversationId: conv.id,
        level: input.level,
        reason,
      })
      .returning();
    event = ins[0]!;
    created = true;
  }

  if (input.level === "urgente" && !conv.handoffAt) {
    await db
      .update(schema.conversation)
      .set({
        aiEnabled: false,
        handoffAt: new Date(),
        handoffReason: "urgencia",
        updatedAt: new Date(),
      })
      .where(eq(schema.conversation.id, conv.id));
  }

  publish(input.organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conv.id } },
  });
  publish(input.organizationId, {
    type: "triage.new",
    data: { triageId: event.id, conversationId: conv.id, level: event.level },
  });
  return { event, created, message };
}

/**
 * La red determinista: se llama con cada mensaje entrante de texto. Nunca
 * lanza — una falla acá no puede tirar la ingesta del mensaje del paciente.
 */
export async function watchInbound(input: {
  organizationId: string;
  conversationId: string;
  text: string | null;
}): Promise<UrgencyMatch | null> {
  try {
    if (!input.text) return null;
    const health = await getHealthSettings(input.organizationId);
    const match = detectUrgency(input.text, health.urgencyKeywords);
    if (!match) return null;
    // Solo vigila instancias con el vertical salud en uso (profesionales).
    const pro = await getDb()
      .select({ id: schema.professional.id })
      .from(schema.professional)
      .where(scoped(schema.professional.organizationId, input.organizationId))
      .limit(1);
    if (pro.length === 0) return null;
    await recordTriage({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      level: match.level,
      reason: match.reason,
    });
    return match;
  } catch (err) {
    console.warn(
      "[salud] vigilancia de urgencias falló:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function listOpenTriage(organizationId: string) {
  return getDb()
    .select({
      event: schema.triageEvent,
      contactName: schema.contact.name,
    })
    .from(schema.triageEvent)
    .leftJoin(schema.contact, eq(schema.triageEvent.contactId, schema.contact.id))
    .where(
      scoped(
        schema.triageEvent.organizationId,
        organizationId,
        isNull(schema.triageEvent.resolvedAt)
      )
    )
    .orderBy(desc(schema.triageEvent.createdAt))
    .limit(100);
}

export async function resolveTriage(
  organizationId: string,
  id: string
): Promise<boolean> {
  const db = getDb();
  // Monotónico (constitución IV): solo se sella la primera vez; marcar de
  // nuevo una urgencia ya atendida no pisa la hora original y sigue siendo ok.
  const upd = await db
    .update(schema.triageEvent)
    .set({ resolvedAt: new Date() })
    .where(
      scoped(
        schema.triageEvent.organizationId,
        organizationId,
        and(eq(schema.triageEvent.id, id), isNull(schema.triageEvent.resolvedAt))
      )
    )
    .returning({ id: schema.triageEvent.id });
  if (upd.length > 0) return true;
  const existe = await db
    .select({ id: schema.triageEvent.id })
    .from(schema.triageEvent)
    .where(
      scoped(
        schema.triageEvent.organizationId,
        organizationId,
        eq(schema.triageEvent.id, id)
      )
    )
    .limit(1);
  return existe.length > 0;
}
