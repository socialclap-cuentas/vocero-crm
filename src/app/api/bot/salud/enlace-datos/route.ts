import { z } from "zod";
import { parseBody } from "@/lib/api";
import { getEnv } from "@/lib/env";
import {
  guardBot,
  resolveConversation,
  saludErrorResponse,
} from "@/server/salud/http";
import { createDataLink } from "@/server/salud/enlace-datos";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ conversationId: z.string().min(1) });

/**
 * Crea un enlace de un solo uso (24 h) para que el paciente complete su
 * documento en una página del CRM, fuera de WhatsApp.
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
    const link = await createDataLink(
      gate.organizationId,
      conv.contactId,
      body.data.conversationId,
      getEnv().APP_BASE_URL
    );
    return Response.json(link, { status: 201 });
  } catch (err) {
    return saludErrorResponse(err);
  }
}
