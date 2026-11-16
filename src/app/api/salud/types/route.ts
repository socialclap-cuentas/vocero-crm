import { parseBody, withAuth } from "@/lib/api";
import {
  createAppointmentType,
  listAppointmentTypes,
} from "@/server/salud/catalog";
import { agendaGate, panelError } from "@/server/salud/panel";
import { typeBody } from "@/server/salud/schemas";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const gate = agendaGate();
  if (gate) return gate;
  return Response.json({
    types: await listAppointmentTypes(session.organizationId),
  });
});

export const POST = withAuth(async (session, req: Request) => {
  const gate = agendaGate();
  if (gate) return gate;
  const body = await parseBody(req, typeBody);
  if (!body.ok) return body.response;
  try {
    const type = await createAppointmentType(session.organizationId, body.data);
    return Response.json({ type }, { status: 201 });
  } catch (err) {
    return panelError(err);
  }
});
