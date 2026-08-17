import { getEnv } from "@/lib/env";

export class GoogleCalendarError extends Error {}
export class GoogleReauthRequired extends GoogleCalendarError {}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

/** Access token de corta vida a partir del refresh token guardado. */
export async function getAccessToken(refreshToken: string): Promise<string> {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new GoogleCalendarError("Google OAuth no configurado (faltan credenciales de la app)");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (res.status === 400 || res.status === 401) {
    // invalid_grant: el usuario revocó el acceso, o el refresh token expiró.
    throw new GoogleReauthRequired("El acceso a Google Calendar expiró — hay que reconectar");
  }
  if (!res.ok) {
    throw new GoogleCalendarError(`token refresh devolvió ${res.status}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export type FreeBusyWindow = { start: string; end: string };

/** Franjas OCUPADAS del calendario en el rango dado (ISO 8601, con TZ). */
export async function getFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<FreeBusyWindow[]> {
  const res = await fetch(`${CALENDAR_BASE}/freeBusy`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      items: [{ id: calendarId }],
    }),
  });
  if (!res.ok) {
    throw new GoogleCalendarError(`freeBusy devolvió ${res.status}`);
  }
  const data = (await res.json()) as {
    calendars: Record<string, { busy: FreeBusyWindow[] }>;
  };
  return data.calendars[calendarId]?.busy ?? [];
}

export type CreateEventInput = {
  calendarId: string;
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  timeZone: string;
  attendeeEmail?: string | null;
  withMeet: boolean;
};

export type CreatedEvent = {
  eventId: string;
  htmlLink: string;
  meetLink: string | null;
};

export async function createEvent(
  accessToken: string,
  input: CreateEventInput
): Promise<CreatedEvent> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startIso, timeZone: input.timeZone },
    end: { dateTime: input.endIso, timeZone: input.timeZone },
    attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
  };
  if (input.withMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const url = new URL(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events`
  );
  if (input.withMeet) url.searchParams.set("conferenceDataVersion", "1");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new GoogleCalendarError(`events.insert devolvió ${res.status}`);
  }
  const data = (await res.json()) as {
    id: string;
    htmlLink: string;
    hangoutLink?: string;
  };
  return {
    eventId: data.id,
    htmlLink: data.htmlLink,
    meetLink: data.hangoutLink ?? null,
  };
}

/** Perfil básico de la cuenta conectada, para mostrar el email en la UI. */
export async function getUserInfo(accessToken: string): Promise<{ email: string }> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new GoogleCalendarError(`userinfo devolvió ${res.status}`);
  return res.json();
}

/** Crea un calendario secundario nuevo, propiedad del usuario conectado. */
export async function createCalendar(
  accessToken: string,
  summary: string,
  timeZone: string
): Promise<{ id: string; summary: string }> {
  const res = await fetch(`${CALENDAR_BASE}/calendars`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ summary, timeZone }),
  });
  if (!res.ok) {
    throw new GoogleCalendarError(`calendars.insert devolvió ${res.status}`);
  }
  const data = (await res.json()) as { id: string; summary: string };
  return data;
}
