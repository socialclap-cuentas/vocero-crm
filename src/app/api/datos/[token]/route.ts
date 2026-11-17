import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { saludErrorResponse } from "@/server/salud/http";
import { submitDataLink } from "@/server/salud/enlace-datos";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  documentNumber: z.string().min(1).max(30),
  birthDate: z.string().max(10).nullish(),
  affiliateNumber: z.string().max(60).nullish(),
});

/**
 * Envío de la página pública /datos/[token]. Sin sesión: la autorización ES el
 * token (un solo uso, 24 h). Limitado por IP para no dejar adivinar.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const ip = clientIp(req.headers);
  if (!checkRateLimit(`datos:${ip}`, { windowMs: 10 * 60 * 1000, max: 20 }).allowed) {
    return apiError(429, "rate_limited", "Demasiados intentos. Probá en unos minutos.");
  }
  const { token } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    await submitDataLink(token, body.data);
    return Response.json({ ok: true });
  } catch (err) {
    return saludErrorResponse(err);
  }
}
