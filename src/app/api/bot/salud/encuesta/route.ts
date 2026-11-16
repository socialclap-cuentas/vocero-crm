import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import {
  guardBot,
  resolveConversation,
  saludErrorResponse,
} from "@/server/salud/http";
import { parseScore, recordSurvey } from "@/server/salud/survey";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  score: z.union([z.number(), z.string()]),
  comment: z.string().max(1000).nullish(),
});

/** La respuesta del paciente a la encuesta post-turno (1 a 5). */
export async function POST(req: Request) {
  const gate = await guardBot(req);
  if ("response" in gate) return gate.response;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const score = parseScore(body.data.score);
  if (score === null) {
    return apiError(422, "invalid_body", "El puntaje debe ser un entero de 1 a 5");
  }
  const conv = await resolveConversation(
    gate.organizationId,
    body.data.conversationId
  );
  if (!conv.ok) return conv.response;
  try {
    const out = await recordSurvey({
      organizationId: gate.organizationId,
      conversationId: body.data.conversationId,
      score,
      comment: body.data.comment ?? null,
    });
    if (!out) {
      return apiError(404, "not_found", "No hay una encuesta pendiente");
    }
    return Response.json({ ok: true, ...out });
  } catch (err) {
    return saludErrorResponse(err);
  }
}
