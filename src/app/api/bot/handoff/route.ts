import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { applyHandoff } from "@/server/ai/pipeline";

export const dynamic = "force-dynamic";

const REASONS = ["cliente", "modelo", "error", "ventana", "hostilidad"] as const;

const bodySchema = z.object({
  conversationId: z.string().min(1),
  reason: z.enum(REASONS).default("modelo"),
});

/**
 * POST /api/bot/handoff {conversationId, reason} — un cerebro externo pausa
 * la IA y marca la conversación para atención humana. Mismo efecto que el
 * handoff que dispara el agente in-process (`applyHandoff`).
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
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  if (!convs[0]) return apiError(404, "not_found", "Conversación no encontrada");

  await applyHandoff(body.data.conversationId, organizationId, body.data.reason ?? "modelo");
  return Response.json({ ok: true });
}
