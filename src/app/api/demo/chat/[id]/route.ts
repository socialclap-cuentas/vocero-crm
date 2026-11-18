import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { demoMode } from "@/server/demo/flag";
import { escribirComoPaciente, SalaDemoError } from "@/server/demo/chat";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const cuerpo = z.object({ text: z.string().trim().min(1).max(1000) });

/** Demo: el prospecto escribe como el paciente de prueba. */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!demoMode()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;
  try {
    await escribirComoPaciente(session.organizationId, id, body.data.text);
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof SalaDemoError) return apiError(err.status, err.code, err.message);
    throw err;
  }
});
