import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { getGoogleCredentialsByOrg, markGoogleReconnectRequired } from "@/server/google/credentials";
import {
  getAccessToken,
  getFreeBusy,
  GoogleReauthRequired,
  type FreeBusyWindow,
} from "@/server/google/calendar";

export const dynamic = "force-dynamic";

const TIMEZONE = "America/Argentina/Buenos_Aires";
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 18;
const SLOT_MINUTES = 45;
const MIN_LEAD_HOURS = 2; // no ofrecer horarios a menos de 2hs de ahora
const LOOKAHEAD_DAYS = 10;

/** Etiqueta en español, ej. "Lunes 18/8, 10:00hs" — zona horaria del negocio. */
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

function overlapsBusy(start: Date, end: Date, busy: FreeBusyWindow[]): boolean {
  return busy.some((w) => {
    const bStart = new Date(w.start).getTime();
    const bEnd = new Date(w.end).getTime();
    return start.getTime() < bEnd && end.getTime() > bStart;
  });
}

/** Hora local (según TIMEZONE) de una fecha, sin depender del huso del server. */
function localHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: TIMEZONE,
    }).format(date)
  );
}

function localWeekday(date: Date): number {
  // 0=domingo … 6=sábado, en la zona horaria del negocio.
  const s = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: TIMEZONE,
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(s);
}

export async function GET(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(6, Number(url.searchParams.get("limit") ?? 6)));

  const creds = await getGoogleCredentialsByOrg(organizationId);
  if (!creds || creds.status !== "connected") {
    // Sin calendario conectado: sin disponibilidad, no es un error de Nea.
    return Response.json({ slots: [] });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(creds.refreshToken);
  } catch (err) {
    if (err instanceof GoogleReauthRequired) {
      await markGoogleReconnectRequired(organizationId);
    }
    return Response.json({ slots: [] });
  }

  const now = new Date();
  const rangeStart = now;
  const rangeEnd = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  let busy: FreeBusyWindow[];
  try {
    busy = await getFreeBusy(
      accessToken,
      creds.calendarId,
      rangeStart.toISOString(),
      rangeEnd.toISOString()
    );
  } catch {
    return Response.json({ slots: [] });
  }

  const minStart = new Date(now.getTime() + MIN_LEAD_HOURS * 60 * 60 * 1000);
  const slots: { startUtc: string; endUtc: string; label: string }[] = [];

  // Barrido en pasos de 15' dentro del rango, filtrando fin de semana y
  // horario fuera de la franja laboral (todo calculado en hora local del
  // negocio, no la del servidor).
  const stepMs = 15 * 60 * 1000;
  for (
    let t = Math.ceil(minStart.getTime() / stepMs) * stepMs;
    t < rangeEnd.getTime() && slots.length < limit;
    t += stepMs
  ) {
    const start = new Date(t);
    const weekday = localWeekday(start);
    if (weekday === 0 || weekday === 6) continue; // fin de semana

    const hour = localHour(start);
    if (hour < BUSINESS_START_HOUR || hour >= BUSINESS_END_HOUR) continue;

    const end = new Date(t + SLOT_MINUTES * 60 * 1000);
    const endHour = localHour(end);
    // el slot no puede terminar después del cierre (endHour===0 es medianoche exacta, no aplica acá)
    if (endHour !== 0 && endHour > BUSINESS_END_HOUR) continue;
    if (endHour === BUSINESS_END_HOUR && end.getMinutes() > 0) continue;

    if (overlapsBusy(start, end, busy)) continue;

    slots.push({
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      label: labelFor(start),
    });
  }

  return Response.json({ slots });
}
