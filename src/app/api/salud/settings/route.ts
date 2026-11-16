import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getHealthSettings, upsertHealthSettings } from "@/server/salud/settings";
import { agendaGate } from "@/server/salud/panel";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  reminderLeadHours: z.array(z.number()).max(2).optional(),
  reminderTemplateId: z.string().nullish(),
  waitlistEnabled: z.boolean().optional(),
  depositPaymentInfo: z.string().max(500).nullish(),
  surveyEnabled: z.boolean().optional(),
  surveyDelayHours: z.number().optional(),
  surveyTemplateId: z.string().nullish(),
  reviewUrl: z.string().max(500).nullish(),
  reactivationEnabled: z.boolean().optional(),
  reactivationMonths: z.number().optional(),
  reactivationTemplateId: z.string().nullish(),
  urgencyMessage: z.string().max(1000).nullish(),
  urgencyKeywords: z.string().max(2000).nullish(),
});

export const GET = withAuth(async (session) => {
  const gate = agendaGate();
  if (gate) return gate;
  return Response.json({ settings: await getHealthSettings(session.organizationId) });
});

export const PUT = withAuth(async (session, req: Request) => {
  const gate = agendaGate();
  if (gate) return gate;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  return Response.json({
    settings: await upsertHealthSettings(session.organizationId, body.data),
  });
});
