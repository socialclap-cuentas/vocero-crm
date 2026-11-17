import { z } from "zod";
import { parseBody } from "@/lib/api";
import { guardBot, resolveConversation, saludErrorResponse } from "@/server/salud/http";
import { AGENT_NOTE_MAX, addContactNote } from "@/server/salud/patient";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1).max(AGENT_NOTE_MAX),
});

/**
 * El agente deja un dato EXTRA del paciente en «Notas del contacto»
 * (preferencias de horario, quién lo acompaña…). Se SUMA una línea, no se
 * pisa lo del equipo. Nada clínico ni el turno mismo: eso ya tiene su lugar.
 */
export async function POST(req: Request) {
  const gate = await guardBot(req);
  if ("response" in gate) return gate.response;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const conv = await resolveConversation(gate.organizationId, body.data.conversationId);
  if (!conv.ok) return conv.response;
  // El Laboratorio es un sandbox: ahí no se escribe en el contacto real.
  if (conv.isTest) return Response.json({ saved: false, sandbox: true });
  try {
    const out = await addContactNote(gate.organizationId, conv.contactId, body.data.text);
    return Response.json(out);
  } catch (err) {
    return saludErrorResponse(err);
  }
}
