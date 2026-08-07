import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { publish } from "@/server/events/bus";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  ficha: z.record(z.string(), z.unknown()),
});

/**
 * PUT /api/bot/ficha {conversationId, ficha} — un cerebro externo guarda o
 * actualiza la calificación del lead. MERGE: solo las claves enviadas se
 * sobrescriben, el resto de la ficha existente se conserva.
 */
export async function PUT(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

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

  const leads = await db
    .select({ id: schema.lead.id, ficha: schema.lead.ficha })
    .from(schema.lead)
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.contactId, conv.contactId)
      )
    )
    .limit(1);
  const lead = leads[0];
  if (!lead) return apiError(404, "not_found", "Lead no encontrado para esta conversación");

  const merged = {
    ...((lead.ficha as Record<string, unknown>) ?? {}),
    ...body.data.ficha,
  };

  await db
    .update(schema.lead)
    .set({ ficha: merged, updatedAt: new Date() })
    .where(eq(schema.lead.id, lead.id));

  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: body.data.conversationId } },
  });

  return Response.json({ ok: true, ficha: merged });
}
