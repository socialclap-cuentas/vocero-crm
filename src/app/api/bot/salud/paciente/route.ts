import { z } from "zod";
import { parseBody } from "@/lib/api";
import {
  guardBot,
  resolveConversation,
  saludErrorResponse,
} from "@/server/salud/http";
import { getPatient, upsertPatient } from "@/server/salud/patient";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  documentNumber: z.string().max(30).nullish(),
  birthDate: z.string().max(10).nullish(),
  insuranceId: z.string().min(1).nullish(),
  affiliateNumber: z.string().max(60).nullish(),
  optOutFollowups: z.boolean().optional(),
});

/**
 * Datos ADMINISTRATIVOS del paciente (documento, nacimiento, obra social,
 * afiliado). Nada clínico: el agente no guarda síntomas ni diagnósticos.
 */
export async function PUT(req: Request) {
  const gate = await guardBot(req);
  if ("response" in gate) return gate.response;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const conv = await resolveConversation(
    gate.organizationId,
    body.data.conversationId
  );
  if (!conv.ok) return conv.response;
  const { conversationId: _c, ...fields } = body.data;
  void _c;
  try {
    const patient = await upsertPatient(gate.organizationId, conv.contactId, fields);
    return Response.json({ patient });
  } catch (err) {
    return saludErrorResponse(err);
  }
}

export async function GET(req: Request) {
  const gate = await guardBot(req);
  if ("response" in gate) return gate.response;
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId) {
    return Response.json(
      { error: { code: "invalid_body", message: "Falta conversationId" } },
      { status: 422 }
    );
  }
  const conv = await resolveConversation(gate.organizationId, conversationId);
  if (!conv.ok) return conv.response;
  try {
    return Response.json({
      patient: await getPatient(gate.organizationId, conv.contactId),
    });
  } catch (err) {
    return saludErrorResponse(err);
  }
}
