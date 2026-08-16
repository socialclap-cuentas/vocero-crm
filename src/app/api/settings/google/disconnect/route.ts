import { withAuth } from "@/lib/api";
import { disconnectGoogle } from "@/server/google/credentials";

export const dynamic = "force-dynamic";

export const DELETE = withAuth(async (session) => {
  await disconnectGoogle(session.organizationId);
  return Response.json({ ok: true });
});
