import { parseBody, withAuth } from "@/lib/api";
import {
  createProfessional,
  listProfessionals,
} from "@/server/salud/catalog";
import { agendaGate, panelError } from "@/server/salud/panel";
import { professionalBody } from "@/server/salud/schemas";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const gate = agendaGate();
  if (gate) return gate;
  return Response.json({
    professionals: await listProfessionals(session.organizationId),
  });
});

export const POST = withAuth(async (session, req: Request) => {
  const gate = agendaGate();
  if (gate) return gate;
  const body = await parseBody(req, professionalBody);
  if (!body.ok) return body.response;
  try {
    const professional = await createProfessional(session.organizationId, body.data);
    return Response.json({ professional }, { status: 201 });
  } catch (err) {
    return panelError(err);
  }
});
