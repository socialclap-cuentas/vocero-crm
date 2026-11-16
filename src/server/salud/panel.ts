import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { SaludError } from "@/server/salud/catalog";
import { apiError } from "@/lib/api";

/** 070 — Atajos comunes de las rutas del panel del vertical salud. */

/** null si la agenda está encendida; si no, la respuesta 404 estándar. */
export function agendaGate(): Response | null {
  return agendaEnabled() ? null : agendaDisabledResponse();
}

/** SaludError → sobre estándar; cualquier otro error se relanza (withAuth lo vuelve 500). */
export function panelError(err: unknown): Response {
  if (err instanceof SaludError) {
    const status =
      err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 422;
    return apiError(
      status,
      err.code === "invalid" ? "invalid_body" : err.code,
      err.message
    );
  }
  throw err;
}
