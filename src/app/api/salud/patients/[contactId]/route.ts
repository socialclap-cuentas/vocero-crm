import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getPatient, upsertPatient } from "@/server/salud/patient";
import { agendaGate, panelError } from "@/server/salud/panel";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ contactId: string }> };

const putSchema = z.object({
  documentNumber: z.string().max(30).nullish(),
  birthDate: z.string().max(10).nullish(),
  insuranceId: z.string().nullish(),
  affiliateNumber: z.string().max(60).nullish(),
  adminNotes: z.string().max(2000).nullish(),
  optOutFollowups: z.boolean().optional(),
});

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const gate = agendaGate();
  if (gate) return gate;
  const { contactId } = await ctx.params;
  try {
    return Response.json({ patient: await getPatient(session.organizationId, contactId) });
  } catch (err) {
    return panelError(err);
  }
});

export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  const gate = agendaGate();
  if (gate) return gate;
  const { contactId } = await ctx.params;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  try {
    return Response.json({
      patient: await upsertPatient(session.organizationId, contactId, body.data),
    });
  } catch (err) {
    return panelError(err);
  }
});
