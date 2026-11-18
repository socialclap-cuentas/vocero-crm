import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { upsertFicha, type Ficha } from "@/server/bot/ficha";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { onLeadActivity } from "@/server/inbox/lead-activity";

/**
 * Alta de un registro que viene del chat guiado de la landing.
 *
 * La landing (función serverless en Vercel) llama acá con una clave de
 * servicio; el navegador nunca la ve. El contacto se identifica por el
 * teléfono de WhatsApp (549 + área + número), el mismo formato con el que
 * Meta entrega los mensajes entrantes — por eso, cuando la persona escribe
 * después, el CRM y el agente la reconocen sin hacer nada más.
 */

export const LANDING_ORIGIN = "formulario landing";

const clean = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((s) => s.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim());

export const landingLeadSchema = z.object({
  nombre: clean(60),
  apellido: clean(60),
  /** Solo dígitos, formato WhatsApp Argentina móvil: 549 + 10 dígitos. */
  telefono: z.string().trim().regex(/^549\d{10}$/, "Teléfono inválido"),
  email: z.string().trim().toLowerCase().email().max(120),
  rubro: clean(80),
  consultas_por_dia: clean(40),
  /** De dónde salió (por ahora siempre la landing de TurnoMaster). */
  pagina: clean(120).optional(),
});

export type LandingLead = z.infer<typeof landingLeadSchema>;

export function requireIntakeKey(req: Request): Response | null {
  const rl = checkRateLimit("landing-intake", { windowMs: 60_000, max: 60 });
  if (!rl.allowed) return apiError(429, "rate_limited", "Demasiadas solicitudes");

  const expected = process.env.LANDING_INTAKE_KEY;
  const provided = req.headers.get("x-intake-key");
  if (!expected || expected.length < 16 || !provided) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  return null;
}

/**
 * Datos del registro como van a la ficha del contacto. El origen original gana
 * si la persona ya estaba (por ejemplo, si escribió por WhatsApp antes de
 * registrarse); el resto son datos que la persona acaba de dar y pisan los viejos.
 */
export function buildFichaPatch(
  lead: LandingLead,
  existing: Record<string, unknown> | null | undefined,
  now: Date
): Ficha {
  const patch: Ficha = {
    nombre: lead.nombre,
    apellido: lead.apellido,
    email: lead.email,
    rubro: lead.rubro,
    consultas_por_dia: lead.consultas_por_dia,
    registrado_en_landing: now.toISOString(),
  };
  if (lead.pagina) patch.pagina_registro = lead.pagina;
  if (!existing || !existing.origen) patch.origen = LANDING_ORIGIN;
  return patch;
}

export async function registerLandingLead(
  organizationId: string,
  lead: LandingLead
): Promise<{ contactId: string; isNew: boolean }> {
  const db = getDb();
  const now = new Date();
  const fullName = `${lead.nombre} ${lead.apellido}`;

  // La identidad es el teléfono tal cual lo entrega Meta (549 + área + número),
  // la misma llave que usa el webhook: por eso, cuando la persona escribe
  // después, cae sobre este mismo contacto y el agente la reconoce.
  const { contact, isNew } = await getOrCreateContactByIdentity(organizationId, {
    identity: lead.telefono,
    channel: "whatsapp",
    phone: lead.telefono,
    waUserId: null,
    profileName: fullName,
  });

  await upsertFicha({
    organizationId,
    contactId: contact.id,
    ficha: buildFichaPatch(lead, contact.ficha, now),
  });

  // Su lugar en el tablero: primera etapa abierta, o solo "actividad" si ya estaba.
  await onLeadActivity(organizationId, contact.id, now);

  // El nombre real que dio la persona gana sobre el del perfil de WhatsApp y
  // queda fijo (`manual`: ni los mensajes siguientes ni nadie lo pisa). Un
  // nombre que ya puso una persona del equipo se respeta.
  if (contact.nameSource !== "manual") {
    await db
      .update(schema.contact)
      .set({ name: fullName, nameSource: "manual", updatedAt: now })
      .where(eq(schema.contact.id, contact.id));
  }

  return { contactId: contact.id, isNew };
}
