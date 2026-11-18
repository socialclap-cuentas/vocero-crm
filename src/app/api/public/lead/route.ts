import { apiError, parseBody } from "@/lib/api";
import {
  landingLeadSchema,
  requireIntakeKey,
  registerLandingLead,
} from "@/server/leads/landing-intake";
import { resolveInstanceOrg } from "@/server/bot/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/lead — alta desde el chat guiado de la landing.
 * Auth: header X-Intake-Key contra LANDING_INTAKE_KEY (solo la función
 * serverless de la landing la conoce). Idempotente por teléfono.
 */
export async function POST(req: Request) {
  const denied = requireIntakeKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, landingLeadSchema);
  if (!body.ok) return body.response;

  const { contactId, isNew } = await registerLandingLead(organizationId, body.data);
  return Response.json({ ok: true, contactId, isNew }, { status: isNew ? 201 : 200 });
}
