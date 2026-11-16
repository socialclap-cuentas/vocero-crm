import { z } from "zod";
import { parseBody } from "@/lib/api";
import {
  guardBot,
  resolveConversation,
  saludErrorResponse,
} from "@/server/salud/http";
import { recordTriage } from "@/server/salud/triage";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  // Tolerante con el LLM: cualquier otra cosa cuenta como la más seria.
  level: z.string().optional(),
  reason: z.string().max(300).optional(),
});

/**
 * El agente detectó una urgencia. Queda registrada, avisa a la bandeja y, si es
 * urgente, la conversación pasa a una persona. La respuesta trae el mensaje
 * que el agente debe decirle al paciente (configurable por el consultorio).
 *
 * El agente NO diagnostica ni da indicaciones médicas: deriva.
 */
export async function POST(req: Request) {
  const gate = await guardBot(req);
  if ("response" in gate) return gate.response;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const conv = await resolveConversation(
    gate.organizationId,
    body.data.conversationId
  );
  if (!conv.ok) return conv.response;
  const level =
    body.data.level?.trim().toLowerCase() === "prioritario"
      ? "prioritario"
      : "urgente";
  try {
    const r = await recordTriage({
      organizationId: gate.organizationId,
      conversationId: body.data.conversationId,
      level,
      reason: body.data.reason ?? "sin detalle",
    });
    return Response.json({
      ok: true,
      triageId: r.event.id,
      level: r.event.level,
      message: r.message,
    });
  } catch (err) {
    return saludErrorResponse(err);
  }
}
