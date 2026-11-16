import { guardBot, saludErrorResponse } from "@/server/salud/http";
import { getCatalogForAgent } from "@/server/salud/catalog";
import {
  DEFAULT_URGENCY_MESSAGE,
  getHealthSettings,
} from "@/server/salud/settings";

export const dynamic = "force-dynamic";

/**
 * 070 — Lo que el agente puede decirle a un paciente: profesionales, tipos de
 * turno (duración, precio, preparación, seña), obras sociales y las reglas del
 * consultorio. Lo que no está acá, el agente no lo sabe y no lo inventa.
 */
export async function GET(req: Request) {
  const gate = await guardBot(req);
  if ("response" in gate) return gate.response;
  try {
    const [catalog, health] = await Promise.all([
      getCatalogForAgent(gate.organizationId),
      getHealthSettings(gate.organizationId),
    ]);
    return Response.json({
      ...catalog,
      rules: {
        depositPaymentInfo: health.depositPaymentInfo,
        reviewUrl: health.reviewUrl,
        urgencyMessage: health.urgencyMessage ?? DEFAULT_URGENCY_MESSAGE,
        waitlistEnabled: health.waitlistEnabled,
      },
    });
  } catch (err) {
    return saludErrorResponse(err);
  }
}
