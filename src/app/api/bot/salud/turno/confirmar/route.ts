import { z } from "zod";
import { parseBody } from "@/lib/api";
import {
  guardBot,
  resolveConversation,
  saludErrorResponse,
} from "@/server/salud/http";
import { confirmNextBooking } from "@/server/salud/reminders";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ conversationId: z.string().min(1) });

/** El paciente confirma su turno respondiendo el recordatorio. */
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
    const b = await confirmNextBooking({
      organizationId: gate.organizationId,
      conversationId: body.data.conversationId,
    });
    return Response.json({
      ok: true,
      bookingId: b.id,
      scheduledAt: b.scheduledAt.toISOString(),
      depositStatus: b.depositStatus,
      depositAmount: b.depositAmount,
    });
  } catch (err) {
    return saludErrorResponse(err);
  }
}
