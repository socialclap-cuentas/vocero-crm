import { apiError, withAuth } from "@/lib/api";
import { resolveTriage } from "@/server/salud/triage";
import { agendaGate } from "@/server/salud/panel";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Marca la urgencia como atendida. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const gate = agendaGate();
  if (gate) return gate;
  const { id } = await ctx.params;
  const ok = await resolveTriage(session.organizationId, id);
  if (!ok) return apiError(404, "not_found", "Urgencia no encontrada");
  return Response.json({ ok: true });
});
