import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { renderKb } from "@/server/ai/prompts";

export const dynamic = "force-dynamic";

/**
 * Perfil del agente + Knowledge Base para un cerebro externo (`/api/bot/*`).
 * GET /api/bot/profile → { profile, kb, resources } | 404 si no hay agent
 * profile configurado todavía (el bot cae a su fallback local).
 *
 * Formato de salida acordado con el consumidor (Nea `app/profile.py`):
 * profile.{name,tone,instructions,escalationRules,greeting} + kb (texto
 * renderizado, mismo formato que usa el agente in-process) + resources.
 */
export async function GET(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const db = getDb();
  const profiles = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profiles[0];
  if (!profile) {
    return apiError(404, "not_found", "Sin agent profile configurado todavía");
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));

  return Response.json({
    profile: {
      name: profile.name,
      tone: profile.tone,
      instructions: profile.instructions,
      escalationRules: profile.escalationRules,
      greeting: profile.greeting,
    },
    kb: renderKb(kb),
    resources: [],
  });
}
