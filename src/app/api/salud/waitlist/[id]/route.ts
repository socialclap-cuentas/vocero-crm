import { apiError, withAuth } from "@/lib/api";
import { cancelWaitlistEntry } from "@/server/salud/waitlist";
import { agendaGate } from "@/server/salud/panel";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const gate = agendaGate();
  if (gate) return gate;
  const { id } = await ctx.params;
  const ok = await cancelWaitlistEntry(session.organizationId, id);
  if (!ok) return apiError(404, "not_found", "Entrada no encontrada");
  return Response.json({ ok: true });
});
