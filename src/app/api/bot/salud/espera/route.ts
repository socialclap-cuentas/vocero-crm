import { z } from "zod";
import { parseBody } from "@/lib/api";
import {
  guardBot,
  resolveConversation,
  saludErrorResponse,
} from "@/server/salud/http";
import { joinWaitlist } from "@/server/salud/waitlist";
import { getHealthSettings } from "@/server/salud/settings";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  professionalId: z.string().min(1).nullish(),
  appointmentTypeId: z.string().min(1).nullish(),
  preferences: z.string().max(500).nullish(),
});

/** Anota al paciente en la lista de espera cuando no hay horarios que le sirvan. */
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
  const health = await getHealthSettings(gate.organizationId);
  if (!health.waitlistEnabled) {
    return apiError(409, "waitlist_disabled", "La lista de espera está apagada");
  }
  try {
    const entry = await joinWaitlist({
      organizationId: gate.organizationId,
      contactId: conv.contactId,
      conversationId: body.data.conversationId,
      professionalId: body.data.professionalId ?? null,
      appointmentTypeId: body.data.appointmentTypeId ?? null,
      preferences: body.data.preferences ?? null,
    });
    return Response.json({ ok: true, waitlistId: entry.id }, { status: 201 });
  } catch (err) {
    return saludErrorResponse(err);
  }
}
