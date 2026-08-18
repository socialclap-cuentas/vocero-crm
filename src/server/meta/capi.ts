import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";

const GRAPH_VERSION = "v21.0";

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/** Normaliza a solo dígitos (Meta pide el hash del teléfono en E.164 sin '+'). */
function hashPhone(phone: string): string {
  return sha256(phone.replace(/[^\d]/g, ""));
}

export type CapiChannel = "whatsapp" | "instagram" | "messenger";

/**
 * Envía el evento Lead real a Meta vía Conversions API — se llama SOLO
 * cuando llega el primer mensaje real de un contacto nuevo (no cuando
 * alguien toca un botón). Reemplaza al fbq('track','Lead') del cliente,
 * que disparaba en el submit del form sin ninguna confirmación de que
 * la conversación arrancó de verdad (ver diagnóstico 17/8).
 *
 * Si no hay token/pixel configurado, no rompe nada: solo loguea y sigue
 * — igual que el resto de las integraciones opcionales de esta app.
 */
export async function sendLeadEvent(input: {
  channel: CapiChannel;
  phone?: string | null; // solo whatsapp
  externalId?: string | null; // instagram/messenger (IGSID/PSID)
  eventTimeMs: number;
}): Promise<void> {
  const env = getEnv();
  const accessToken = env.META_CAPI_ACCESS_TOKEN;
  const pixelId = env.META_PIXEL_ID;
  if (!accessToken || !pixelId) {
    console.log("[capi] sin META_CAPI_ACCESS_TOKEN/META_PIXEL_ID configurado — evento Lead omitido");
    return;
  }

  const userData: Record<string, unknown> = {};
  if (input.channel === "whatsapp" && input.phone) {
    userData.ph = [hashPhone(input.phone)];
  } else if (input.externalId) {
    // Instagram/Messenger: Meta identifica por el ID de la conversación,
    // no hay campo de hash estándar aplicable — se manda igual el evento
    // para que cuente en el dataset, sin match determinístico de usuario.
  }

  const body = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(input.eventTimeMs / 1000),
        action_source: "business_messaging",
        messaging_channel: input.channel,
        user_data: userData,
      },
    ],
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${accessToken}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      console.error("[capi] Meta devolvió", res.status, await res.text());
    }
  } catch (err) {
    // Nunca debe romper el ingreso del mensaje real por un fallo de CAPI.
    console.error("[capi] error de red enviando evento Lead:", err);
  }
}
