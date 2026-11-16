import { parseBody, withAuth } from "@/lib/api";
import { deleteProfessional, updateProfessional } from "@/server/salud/catalog";
import { agendaGate, panelError } from "@/server/salud/panel";
import { professionalBody } from "@/server/salud/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const gate = agendaGate();
  if (gate) return gate;
  const { id } = await ctx.params;
  const body = await parseBody(req, professionalBody.partial());
  if (!body.ok) return body.response;
  try {
    const professional = await updateProfessional(
      session.organizationId,
      id,
      body.data
    );
    return Response.json({ professional });
  } catch (err) {
    return panelError(err);
  }
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const gate = agendaGate();
  if (gate) return gate;
  const { id } = await ctx.params;
  try {
    await deleteProfessional(session.organizationId, id);
    return Response.json({ ok: true });
  } catch (err) {
    return panelError(err);
  }
});
