import { and, desc, eq } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { isWindowOpen } from "@/server/inbox/window";

export const dynamic = "force-dynamic";

/**
 * GET /api/bot/context?waIdentity=... — resuelve la conversación vigente
 * para un contacto a partir de su identidad de WhatsApp (hoy: teléfono
 * normalizado; esta instancia todavía no trae el fix de BSUID/521-52 del
 * repo original — ver docs/pendientes).
 *
 * 404 si el CRM todavía no conoce esa identidad (el bot cae a su fallback).
 */
export async function GET(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const url = new URL(req.url);
  const waIdentity = url.searchParams.get("waIdentity");
  if (!waIdentity) {
    return apiError(422, "invalid_query", "Falta el parámetro waIdentity");
  }

  const db = getDb();
  const contacts = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(eq(schema.contact.organizationId, organizationId), eq(schema.contact.phone, waIdentity))
    )
    .limit(1);
  const contact = contacts[0];
  if (!contact) return apiError(404, "not_found", "Identidad desconocida para esta instancia");

  const convs = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, contact.id)
      )
    )
    .orderBy(desc(schema.conversation.lastMessageAt))
    .limit(1);
  const conv = convs[0];
  if (!conv) return apiError(404, "not_found", "Sin conversación todavía para esa identidad");

  return Response.json({
    conversation: {
      id: conv.id,
      aiEnabled: conv.aiEnabled && !conv.handoffAt,
      windowOpen: isWindowOpen(conv.lastInboundAt),
    },
  });
}
