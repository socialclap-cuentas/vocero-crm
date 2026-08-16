import { withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export const GET = withAuth(async (session) => {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response("Google OAuth no configurado (falta GOOGLE_CLIENT_ID)", {
      status: 500,
    });
  }

  const redirectUri = `${env.APP_BASE_URL}/api/settings/google/callback`;
  const state = Buffer.from(
    JSON.stringify({ organizationId: session.organizationId })
  ).toString("base64url");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("access_type", "offline");
  // Fuerza a Google a devolver refresh_token también en reconexiones
  // (sin esto, una segunda autorización del mismo usuario no lo incluye).
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return Response.redirect(url.toString(), 302);
});
