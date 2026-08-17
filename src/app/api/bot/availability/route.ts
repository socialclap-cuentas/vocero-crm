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
// Argentina no usa horario de verano desde 2009 — offset fijo UTC-3.
const ART_OFFSET_HOURS = 3;

const BUSINESS_START_HOUR = 10;
const BUSINESS_END_HOUR = 18;
const MEETING_DURATION_MINUTES = 40; // duración real de cada reunión
const SLOT_INTERVAL_MINUTES = 45; // cadencia entre horarios ofrecidos (deja margen)
const MIN_LEAD_HOURS = 2; // no ofrecer horarios a menos de 2hs de ahora
const MAX_LEAD_HOURS = 48; // no ofrecer horarios a más de 48hs de ahora

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

type LocalParts = { year: number; month: number; day: number; weekday: number };

/** Año/mes/día/día-de-semana de una fecha, en la zona horaria del negocio. */
function localParts(date: Date): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    timeZone: TIMEZONE,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayStr = get("weekday");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayStr);
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday,
  };
}

/** Instante UTC correspondiente a una hora de pared en ART (offset fijo -3). */
function artWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + ART_OFFSET_HOURS, minute));
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
  const minStart = new Date(now.getTime() + MIN_LEAD_HOURS * 60 * 60 * 1000);
  const rangeEnd = new Date(now.getTime() + MAX_LEAD_HOURS * 60 * 60 * 1000);

  let busy: FreeBusyWindow[];
  try {
    busy = await getFreeBusy(accessToken, creds.calendarId, now.toISOString(), rangeEnd.toISOString());
  } catch {
    return Response.json({ slots: [] });
  }

  const slots: { startUtc: string; endUtc: string; label: string }[] = [];

  // Recorre día por día (hoy, mañana, pasado) dentro de la ventana de 48hs,
  // generando horarios fijos cada 45' desde las 10:00 ART hasta que la
  // reunión (40') entre antes del cierre.
  for (let dayOffset = 0; dayOffset <= 2 && slots.length < limit; dayOffset++) {
    const dayRef = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const { year, month, day, weekday } = localParts(dayRef);
    if (weekday === 0 || weekday === 6) continue; // fin de semana

    for (
      let minutesFromOpen = 0;
      BUSINESS_START_HOUR * 60 + minutesFromOpen + MEETING_DURATION_MINUTES <= BUSINESS_END_HOUR * 60;
      minutesFromOpen += SLOT_INTERVAL_MINUTES
    ) {
      if (slots.length >= limit) break;

      const totalMin = BUSINESS_START_HOUR * 60 + minutesFromOpen;
      const hour = Math.floor(totalMin / 60);
      const minute = totalMin % 60;
      const start = artWallTimeToUtc(year, month, day, hour, minute);

      if (start.getTime() < minStart.getTime() || start.getTime() > rangeEnd.getTime()) continue;

      const end = new Date(start.getTime() + MEETING_DURATION_MINUTES * 60 * 1000);
      if (overlapsBusy(start, end, busy)) continue;

      slots.push({
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        label: labelFor(start),
      });
    }
  }

  return Response.json({ slots });
}
