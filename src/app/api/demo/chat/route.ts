import { withAuth } from "@/lib/api";
import { demoMode } from "@/server/demo/flag";
import { nuevaSalaDeDemo } from "@/server/demo/chat";

export const dynamic = "force-dynamic";

/** Demo: abre una conversación nueva con un paciente de prueba. */
export const POST = withAuth(async (session) => {
  if (!demoMode()) return new Response(null, { status: 404 });
  const sala = await nuevaSalaDeDemo(session.organizationId);
  return Response.json(sala, { status: 201 });
});
