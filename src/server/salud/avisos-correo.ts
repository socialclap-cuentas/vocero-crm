import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { correoConfigurado, enviarCorreo, type Correo } from "@/lib/mail/resend";
import { getBookingItem, type BookingListItem } from "@/server/agenda/queries";
import { getHealthSettings, parseEmails } from "@/server/salud/settings";

/**
 * 071 — Avisos por correo al consultorio: turno nuevo, cancelado, cambio de
 * horario y urgencia. Conector opcional (apagado sin Resend): ninguna función
 * de aquí lanza, así que un correo caído jamás deshace una cita ni una alerta.
 *
 * Privacidad: llevan lo administrativo (quién, cuándo, con quién). NUNCA el
 * motivo de una urgencia ni nada clínico — el correo es un canal menos
 * resguardado que el sistema; la urgencia solo avisa y apunta a la conversación.
 */

export type TipoAviso = "nuevo" | "cancelado" | "reprogramado";

const TITULO: Record<TipoAviso, string> = {
  nuevo: "Turno nuevo",
  cancelado: "Turno cancelado",
  reprogramado: "Turno reprogramado",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** PURA: «jueves 19 nov 2026 · 10:30» desde la fecha y hora ya en la zona del negocio. */
export function cuando(item: Pick<BookingListItem, "weekday" | "date" | "time">): string {
  return `${item.weekday} ${item.date} · ${item.time}`;
}

function plantilla(titulo: string, filas: [string, string][], enlace: { texto: string; url: string }, org: string) {
  const text =
    `${titulo}\n\n` +
    filas.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\n${enlace.texto}: ${enlace.url}\n\n— ${org}`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#141a17">` +
    `<h2 style="margin:0 0 14px;font-size:20px">${esc(titulo)}</h2>` +
    `<table style="border-collapse:collapse;width:100%;font-size:15px">` +
    filas
      .map(
        ([k, v]) =>
          `<tr><td style="padding:7px 12px 7px 0;color:#5f6a65;white-space:nowrap">${esc(k)}</td><td style="padding:7px 0;font-weight:600">${esc(v)}</td></tr>`
      )
      .join("") +
    `</table>` +
    `<p style="margin:20px 0"><a href="${esc(enlace.url)}" style="background:#0d5bff;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:700;display:inline-block">${esc(enlace.texto)}</a></p>` +
    `<p style="color:#5f6a65;font-size:13px;margin:0">${esc(org)}</p></div>`;
  return { text, html };
}

/** PURA: el correo de un turno (sin datos clínicos). */
export function armarCorreoTurno(
  tipo: TipoAviso,
  item: BookingListItem,
  orgName: string,
  baseUrl: string
): Omit<Correo, "to"> {
  const paciente = item.contact?.name.trim() || "Paciente sin nombre";
  const filas: [string, string][] = [
    ["Paciente", paciente],
    ["Cuándo", cuando(item)],
  ];
  if (item.professional) filas.push(["Profesional", item.professional.name]);
  if (item.appointmentType) filas.push(["Tipo de turno", item.appointmentType.name]);
  filas.push(["Lo cargó", item.source === "ai" ? "El asistente" : "El equipo"]);
  const titulo = `${TITULO[tipo]} · ${paciente}`;
  const { text, html } = plantilla(
    TITULO[tipo],
    filas,
    { texto: "Ver la agenda", url: `${baseUrl}/bookings` },
    orgName
  );
  return { subject: `${titulo} · ${cuando(item)}`, text, html };
}

/** PURA: el correo de una urgencia. Sin el motivo: solo quién y dónde mirar. */
export function armarCorreoUrgencia(
  nivel: "urgente" | "prioritario",
  paciente: string,
  conversationId: string,
  orgName: string,
  baseUrl: string
): Omit<Correo, "to"> {
  const titulo = nivel === "urgente" ? "Urgencia" : "Consulta prioritaria";
  const nombre = paciente.trim() || "Un paciente";
  const { text, html } = plantilla(
    titulo,
    [
      ["Paciente", nombre],
      ["Qué hacer", "Abrí la conversación y atendelo. El asistente ya frenó."],
    ],
    { texto: "Abrir la conversación", url: `${baseUrl}/inbox?conversation=${conversationId}` },
    orgName
  );
  return { subject: `${titulo} · ${nombre}`, text, html };
}

async function destinatariosYOrg(organizationId: string) {
  const [settings, orgRows] = await Promise.all([
    getHealthSettings(organizationId),
    getDb().select({ name: schema.organization.name }).from(schema.organization)
      .where(eq(schema.organization.id, organizationId)).limit(1),
  ]);
  return { to: parseEmails(settings.notifyEmails), orgName: orgRows[0]?.name ?? "Consultorio" };
}

function baseUrl(): string {
  return getEnv().APP_BASE_URL.replace(/\/+$/, "");
}

/** Avisa un turno nuevo/cancelado/reprogramado. No lanza; las pruebas del Laboratorio no avisan. */
export async function avisarTurno(
  organizationId: string,
  bookingId: string,
  tipo: TipoAviso
): Promise<void> {
  try {
    if (!correoConfigurado()) return;
    const { to, orgName } = await destinatariosYOrg(organizationId);
    if (to.length === 0) return;
    const item = await getBookingItem(organizationId, bookingId);
    if (!item || item.kind !== "session" || item.isTest) return;
    const r = await enviarCorreo({ to, ...armarCorreoTurno(tipo, item, orgName, baseUrl()) });
    if (!r.ok) console.warn(`[correo] aviso de turno no enviado: ${r.motivo} ${r.detalle ?? ""}`);
  } catch (err) {
    console.warn(`[correo] aviso de turno falló: ${err}`);
  }
}

/** Avisa una urgencia nueva. No lanza. */
export async function avisarUrgencia(
  organizationId: string,
  conversationId: string,
  nivel: "urgente" | "prioritario"
): Promise<void> {
  try {
    if (!correoConfigurado()) return;
    const { to, orgName } = await destinatariosYOrg(organizationId);
    if (to.length === 0) return;
    const rows = await getDb()
      .select({ name: schema.contact.name, isTest: schema.conversation.isTest })
      .from(schema.conversation)
      .leftJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
      .limit(1);
    if (!rows[0] || rows[0].isTest) return;
    const r = await enviarCorreo({
      to,
      ...armarCorreoUrgencia(nivel, rows[0].name ?? "", conversationId, orgName, baseUrl()),
    });
    if (!r.ok) console.warn(`[correo] aviso de urgencia no enviado: ${r.motivo} ${r.detalle ?? ""}`);
  } catch (err) {
    console.warn(`[correo] aviso de urgencia falló: ${err}`);
  }
}

/** El correo de prueba de Configuración: devuelve el resultado para mostrarlo. */
export async function enviarCorreoDePrueba(organizationId: string) {
  const { to, orgName } = await destinatariosYOrg(organizationId);
  if (to.length === 0) return { ok: false as const, motivo: "sin_destinatarios" as const };
  if (!correoConfigurado()) return { ok: false as const, motivo: "apagado" as const };
  const { text, html } = plantilla(
    "Correo de prueba",
    [["Estado", "Los avisos por correo funcionan"]],
    { texto: "Abrir el sistema", url: baseUrl() },
    orgName
  );
  return enviarCorreo({ to, subject: `Prueba de avisos · ${orgName}`, text, html });
}
