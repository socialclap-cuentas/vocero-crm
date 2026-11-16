import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { SaludError } from "@/server/salud/catalog";
import { ReminderError } from "@/server/salud/reminders";

/** 070 — Puerta común de la superficie del bot para el vertical salud. */

export type BotGate = { organizationId: string } | { response: Response };

export async function guardBot(req: Request): Promise<BotGate> {
  // Todo el vertical cuelga de la agenda: sin bandera, no existe.
  if (!agendaEnabled()) return { response: agendaDisabledResponse() };
  const denied = requireBotKey(req);
  if (denied) return { response: denied };
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return {
      response: apiError(409, "no_org", "La instancia aún no tiene organización"),
    };
  }
  return { organizationId };
}

/** La conversación (y su contacto) dentro de la organización, o una respuesta 404. */
export async function resolveConversation(
  organizationId: string,
  conversationId: string
): Promise<
  | { ok: true; contactId: string; isTest: boolean }
  | { ok: false; response: Response }
> {
  const rows = await getDb()
    .select({
      contactId: schema.conversation.contactId,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      response: apiError(404, "not_found", "Conversación no encontrada"),
    };
  }
  return { ok: true, contactId: row.contactId, isTest: row.isTest };
}

/** Errores de dominio → sobre estándar. Cualquier otro se relanza. */
export function saludErrorResponse(err: unknown): Response {
  if (err instanceof SaludError) {
    const status =
      err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 422;
    const code = err.code === "invalid" ? "invalid_body" : err.code;
    return apiError(status, code, err.message);
  }
  if (err instanceof ReminderError) {
    return apiError(
      err.code === "not_found" ? 404 : 422,
      err.code === "invalid" ? "invalid_body" : err.code,
      err.message
    );
  }
  throw err;
}
