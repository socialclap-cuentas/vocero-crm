import { withAuth } from "@/lib/api";
import { getGoogleCredentialsByOrg } from "@/server/google/credentials";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const creds = await getGoogleCredentialsByOrg(session.organizationId);
  if (!creds) {
    return Response.json({ connected: false });
  }
  return Response.json({
    connected: creds.status === "connected",
    status: creds.status,
    googleEmail: creds.googleEmail,
    calendarId: creds.calendarId,
  });
});
