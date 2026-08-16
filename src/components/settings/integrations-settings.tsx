"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Calendar, CheckCircle2, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type GoogleStatus = {
  connected: boolean;
  status?: "connected" | "reconnect_required";
  googleEmail?: string | null;
  calendarId?: string | null;
};

const CALLBACK_MESSAGES: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Google Calendar conectado correctamente." },
  denied: { tone: "error", text: "Cancelaste la conexión con Google." },
  error: { tone: "error", text: "No se pudo completar la conexión. Probá de nuevo." },
  not_configured: {
    tone: "error",
    text: "Falta configurar las credenciales de Google en el servidor (GOOGLE_CLIENT_ID/SECRET).",
  },
  no_refresh_token: {
    tone: "error",
    text: "Google no devolvió el token necesario. Revocá el acceso desde tu cuenta de Google (myaccount.google.com/permissions) y volvé a intentar.",
  },
};

export function IntegrationsSettings() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const searchParams = useSearchParams();
  const callbackFlag = searchParams.get("google");

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/google/status").catch(() => null);
    if (res?.ok) setStatus(await res.json());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function disconnect() {
    setDisconnecting(true);
    await fetch("/api/settings/google/disconnect", { method: "DELETE" }).catch(() => null);
    setDisconnecting(false);
    void refetch();
  }

  const callbackMessage = callbackFlag ? CALLBACK_MESSAGES[callbackFlag] : null;

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      {callbackMessage && (
        <div
          className={
            callbackMessage.tone === "success"
              ? "flex items-start gap-2 rounded-lg border border-[#d8e8dd] bg-[#eff7f1] p-4 text-sm text-[#3f6b52]"
              : "flex items-start gap-2 rounded-lg border border-[#ecd4d2] bg-[#faf1f0] p-4 text-sm text-[#a2504c]"
          }
        >
          {callbackMessage.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p>{callbackMessage.text}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-brand" />
            <CardTitle>Google Calendar</CardTitle>
          </div>
          <CardDescription>
            Conectá tu calendario para que el agente ofrezca horarios reales y agende
            citas — con o sin videollamada (Google Meet) según lo que elija el lead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.status === "reconnect_required" && (
            <div className="flex items-start gap-2 rounded-lg border border-[#ecd4d2] bg-[#faf1f0] p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-[#a2504c]">
                  El acceso a tu Google Calendar expiró o fue revocado.
                </p>
                <p className="text-[#a2504c]/80">
                  El agente no puede agendar citas hasta que reconectes.
                </p>
              </div>
            </div>
          )}

          {status?.connected ? (
            <div className="flex items-center gap-3 rounded-lg border border-[#d8e8dd] bg-[#eff7f1] p-4">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-[#3f6b52]">
                  Conectado{status.googleEmail ? `: ${status.googleEmail}` : ""}
                </p>
                <p className="text-[#3f6b52]/80">
                  Calendario: {status.calendarId ?? "primary"}
                </p>
              </div>
              <Badge variant="success">Conectado</Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin conectar. El agente no puede ofrecer horarios ni agendar citas hasta
              que conectes tu Google Calendar.
            </p>
          )}

          <div className="flex gap-2">
            <a href="/api/settings/google/authorize">
              <Button variant={status?.connected ? "outline" : "default"}>
                <Calendar className="h-4 w-4" />
                {status?.connected ? "Reconectar" : "Conectar con Google"}
              </Button>
            </a>
            {status?.connected && (
              <Button variant="ghost" onClick={() => void disconnect()} disabled={disconnecting}>
                Desconectar
              </Button>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
            <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Cuando un lead pide agendar, el agente pregunta si prefiere llamada o
              videollamada. Si elige videollamada, la cita se crea con un link de
              Google Meet incluido automáticamente.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
