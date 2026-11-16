import { parseBody, withAuth } from "@/lib/api";
import { createInsurance, listInsurances } from "@/server/salud/catalog";
import { agendaGate, panelError } from "@/server/salud/panel";
import { insuranceBody } from "@/server/salud/schemas";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const gate = agendaGate();
  if (gate) return gate;
  return Response.json({
    insurances: await listInsurances(session.organizationId),
  });
});

export const POST = withAuth(async (session, req: Request) => {
  const gate = agendaGate();
  if (gate) return gate;
  const body = await parseBody(req, insuranceBody);
  if (!body.ok) return body.response;
  try {
    const insurance = await createInsurance(session.organizationId, body.data);
    return Response.json({ insurance }, { status: 201 });
  } catch (err) {
    return panelError(err);
  }
});
