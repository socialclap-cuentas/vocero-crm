import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import {
  getGoogleCredentialsByOrg,
  markGoogleReconnectRequired,
} from "@/server/google/credentials";
import {
  createEvent,
  getAccessToken,
  getFreeBusy,
  GoogleReauthRequired,
  type FreeBusyWindow,
} from "@/server/google/calendar";

export const dynamic = "force-dynamic";

const TIMEZONE = "America/Argentina/Buenos_Aires";
const SLOT_MINUTES = 45;

const bodySchema = z.object({
  conversationId: z.string().min(1),
  startUtc: z.string().min(1),
  withVideo: z.boolean().optional().default(false),
});

function labelFor(date: Date): string {
  const dayFmt = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "numeric",
    timeZone: TIMEZONE,
  }).format(date);
  const timeFmt = new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIMEZONE,
  }).format(date);
  const capitalized = dayFmt.charAt(0).toUpperCase() + dayFmt.slice(1);
  return `${capitalized}, ${timeFmt}hs`;
}

export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const start = new Date(body.data.startUtc);
  if (Number.isNaN(start.getTime())) {
    return apiError(400, "invalid_start", "startUtc inválido");
  }
  const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);

  const db = getDb();
  const convs = await db
    .select({ contactId: schema.conversation.contactId })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");

  const contacts = await db
    .select({ name: schema.contact.name, phone: schema.contact.phone })
    .from(schema.contact)
    .where(eq(schema.contact.id, conv.contactId))
    .limit(1);
  const contactInfo = contacts[0];

  const creds = await getGoogleCredentialsByOrg(organizationId);
  if (!creds || creds.status !== "connected") {
    return apiError(409, "no_calendar", "Google Calendar no está conectado");
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(creds.refreshToken);
  } catch (err) {
    if (err instanceof GoogleReauthRequired) {
      await markGoogleReconnectRequired(organizationId);
    }
    return apiError(409, "google_reauth_required", "Hay que reconectar Google Calendar");
  }

  // Chequeo de última hora: el slot pudo ocuparse entre que se ofreció y
  // que el lead lo eligió. Si está ocupado, devolvemos slots frescos.
  let busyNow: FreeBusyWindow[];
  try {
    busyNow = await getFreeBusy(
      accessToken,
      creds.calendarId,
      start.toISOString(),
      end.toISOString()
    );
  } catch {
    busyNow = [];
  }
  const taken = busyNow.some((w) => {
    const bStart = new Date(w.start).getTime();
    const bEnd = new Date(w.end).getTime();
    return start.getTime() < bEnd && end.getTime() > bStart;
  });
  if (taken) {
    // Slots frescos: reusa /api/bot/availability internamente vía fetch
    // propio sería más código; devolvemos vacío y Nea ofrece handoff si
    // no llegan alternativas — comportamiento seguro por defecto.
    return Response.json(
      { code: "slot_taken", slots: [] },
      { status: 409 }
    );
  }

  const contactLabel = contactInfo?.name || contactInfo?.phone || "Lead de WhatsApp";
  let created;
  try {
    created = await createEvent(accessToken, {
      calendarId: creds.calendarId,
      summary: `Llamada con ${contactLabel}`,
      description: contactInfo?.phone
        ? `Agendado automáticamente vía Daniel (WhatsApp). Contacto: ${contactInfo.phone}`
        : "Agendado automáticamente vía Daniel (WhatsApp).",
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      timeZone: TIMEZONE,
      withMeet: Boolean(body.data.withVideo),
    });
  } catch {
    return apiError(502, "google_error", "No se pudo crear el evento en Google Calendar");
  }

  return Response.json(
    {
      bookingId: created.eventId,
      zoomJoinUrl: created.meetLink,
      label: labelFor(start),
    },
    { status: 201 }
  );
}
