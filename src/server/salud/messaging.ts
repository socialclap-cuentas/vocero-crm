import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { replyWindow } from "@/server/inbox/window";
import { sendText } from "@/server/inbox/send";
import { sendTemplate } from "@/server/whatsapp/templates";

/**
 * 070 — Mensajes que el CONSULTORIO inicia (recordatorios, lista de espera,
 * encuesta, reactivación). A diferencia de una respuesta, no hay garantía de
 * que la ventana de 24 h esté abierta:
 *
 *   ventana abierta  → texto libre
 *   ventana cerrada  → plantilla aprobada (si el negocio configuró una)
 *   sin ninguna      → no se envía y se dice por qué; jamás se rompe la regla
 *                      de ventana de Meta.
 */

export type ProactiveResult =
  | { sent: true; via: "text" | "template" }
  | {
      sent: false;
      reason: "sandbox" | "not_found" | "window_closed" | "send_failed";
      detail?: string;
    };

export async function sendProactive(input: {
  organizationId: string;
  conversationId: string;
  text: string;
  templateId?: string | null;
  templateVariables?: string[];
}): Promise<ProactiveResult> {
  const rows = await getDb()
    .select({
      channel: schema.conversation.channel,
      lastInboundAt: schema.conversation.lastInboundAt,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const conv = rows[0];
  if (!conv) return { sent: false, reason: "not_found" };
  if (conv.isTest) return { sent: false, reason: "sandbox" };

  const open = replyWindow(conv.channel, conv.lastInboundAt).standardOpen;
  try {
    if (open) {
      await sendText({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        text: input.text,
        aiGenerated: true,
      });
      return { sent: true, via: "text" };
    }
    if (input.templateId && conv.channel === "whatsapp") {
      await sendTemplate({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        templateId: input.templateId,
        variables: input.templateVariables ?? [],
      });
      return { sent: true, via: "template" };
    }
    return { sent: false, reason: "window_closed" };
  } catch (err) {
    return {
      sent: false,
      reason: "send_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
