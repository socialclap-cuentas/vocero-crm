import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { sendText, SendError } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1),
});

/**
 * POST /api/bot/messages {conversationId, text} — un cerebro externo manda
 * un mensaje al cliente. El token de WhatsApp jamás sale del CRM.
 *
 * 409 {"code":"ai_paused"}     — handoff activo o IA apagada: un humano
 *                                 está (o debería estar) atendiendo, el bot
 *                                 externo no debe escribir acá.
 * 409 {"code":"window_closed"} — más de 24h desde el último mensaje entrante.
 */
export async function POST(req: Request) {
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
    .select()
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

  if (conv.isTest) {
    // Sandbox del Laboratorio: jamás toca la API real (mismo guardrail que
    // el resto de la superficie /api/bot/*).
    return Response.json({ code: "sandbox" }, { status: 409 });
  }
  if (!conv.aiEnabled || conv.handoffAt) {
    return Response.json({ code: "ai_paused" }, { status: 409 });
  }

  try {
    const result = await sendText({
      conversationId: conv.id,
      organizationId,
      text: body.data.text,
      aiGenerated: true,
    });
    return Response.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    if (err instanceof SendError) {
      if (err.code === "window_closed" || err.code === "sandbox_violation") {
        return Response.json(
          { code: err.code === "sandbox_violation" ? "sandbox" : "window_closed" },
          { status: 409 }
        );
      }
      return apiError(502, err.code, err.message);
    }
    throw err;
  }
}
