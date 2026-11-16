import { parseBody, withAuth } from "@/lib/api";
import {
  deleteAppointmentType,
  updateAppointmentType,
} from "@/server/salud/catalog";
import { agendaGate, panelError } from "@/server/salud/panel";
import { typeBody } from "@/server/salud/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const gate = agendaGate();
  if (gate) return gate;
  const { id } = await ctx.params;
  const body = await parseBody(req, typeBody.partial());
  if (!body.ok) return body.response;
  try {
    const type = await updateAppointmentType(session.organizationId, id, body.data);
    return Response.json({ type });
  } catch (err) {
    return panelError(err);
  }
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const gate = agendaGate();
  if (gate) return gate;
  const { id } = await ctx.params;
  try {
    await deleteAppointmentType(session.organizationId, id);
    return Response.json({ ok: true });
  } catch (err) {
    return panelError(err);
  }
});
