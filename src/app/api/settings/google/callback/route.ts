import { getEnv } from "@/lib/env";
import { getUserInfo } from "@/server/google/calendar";
import { saveGoogleCredentials } from "@/server/google/credentials";

export const dynamic = "force-dynamic";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const settingsUrl = `${env.APP_BASE_URL}/settings/integrations`;

  if (error) {
    return Response.redirect(`${settingsUrl}?google=denied`, 302);
  }
  if (!code || !stateRaw) {
    return Response.redirect(`${settingsUrl}?google=error`, 302);
  }

  let organizationId: string;
  try {
    const decoded = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
    organizationId = decoded.organizationId;
    if (!organizationId) throw new Error("sin organizationId");
  } catch {
    return Response.redirect(`${settingsUrl}?google=error`, 302);
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return Response.redirect(`${settingsUrl}?google=not_configured`, 302);
  }

  const redirectUri = `${env.APP_BASE_URL}/api/settings/google/callback`;

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    console.error("[google/callback] token exchange falló:", await tokenRes.text());
    return Response.redirect(`${settingsUrl}?google=error`, 302);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
  };

  if (!tokenData.refresh_token) {
    // Pasa cuando el usuario ya había autorizado antes y Google no reemite
    // el refresh_token — con access_type=offline + prompt=consent no debería
    // ocurrir, pero si pasa, hay que pedirle que revoque el acceso desde su
    // cuenta de Google y vuelva a intentar.
    return Response.redirect(`${settingsUrl}?google=no_refresh_token`, 302);
  }

  let email: string | null = null;
  try {
    const info = await getUserInfo(tokenData.access_token);
    email = info.email;
  } catch {
    // No es bloqueante — el email es solo para mostrar en la UI.
  }

  await saveGoogleCredentials({
    organizationId,
    refreshToken: tokenData.refresh_token,
    googleEmail: email,
  });

  return Response.redirect(`${settingsUrl}?google=connected`, 302);
}
