import { z } from "zod";
import { parseBody } from "@/lib/api";
import {
  guardBot,
  resolveConversation,
  saludErrorResponse,
} from "@/server/salud/http";
import { cancelNextBookingByPatient } from "@/server/salud/reminders";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  /** El agente solo cancela si el paciente lo dijo con claridad. */
  confirmed: z.literal(true),
});

/**
 * El paciente cancela SU turno. A diferencia del resto de la superficie del
 * bot, acá sí se permite cancelar: es su propio turno, el hueco se libera y la
 * lista de espera se activa. `confirmed: true` obliga al agente a haberlo
 * preguntado.
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
  try {
    const b = await cancelNextBookingByPatient({
      organizationId: gate.organizationId,
      conversationId: body.data.conversationId,
    });
    return Response.json({ ok: true, bookingId: b.id });
  } catch (err) {
    return saludErrorResponse(err);
  }
}
