import { after } from "next/server";
import { getEnv } from "@/lib/env";
import {
  isValidSignature,
  isValidWebhookToken,
  type WebhookPayload,
} from "@/server/inbox/webhook";
import {
  processMessagesValue,
  processInstagramValue,
  processMessengerEvent,
} from "@/server/inbox/ingest";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";

/**
 * Webhook público de WhatsApp (contrato webhook.md).
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2: firma x-hub-signature-256 solo si META_APP_SECRET está configurado.
 * El POST siempre responde 200 tras validar; el procesamiento va en after().
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    console.warn("[webhook] token de ruta inválido — 404");
    return new Response(null, { status: 404 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!isValidSignature(rawBody, signature, env.META_APP_SECRET)) {
    console.warn("[webhook] firma inválida — 401");
    return new Response(null, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    console.warn("[webhook] body no es JSON — 200 igual");
    // body ilegible: 200 igualmente (Meta reintenta y termina desactivando)
    return Response.json({ received: true });
  }

  console.log(
    `[webhook] recibido object=${payload.object} entries=${payload.entry?.length ?? 0}`
  );
  if (payload.object === "instagram" || payload.object === "page") {
    console.log("[webhook] payload crudo:", JSON.stringify(payload));
  }

  after(async () => {
    try {
      await processPayload(payload);
    } catch (err) {
      console.error("[webhook] error procesando payload:", err);
    }
  });

  return Response.json({ received: true });
}

async function processPayload(payload: WebhookPayload): Promise<void> {
  if (payload.object === "instagram" || payload.object === "page") {
    // Messenger: entry[].messaging[].
    // Instagram: Meta usa DOS sobres, confirmado en vivo el 2026-08-18 —
    //   - mensajes nuevos (field=messages): entry[].changes[].value
    //     (confirmado con el botón "Test" oficial del dashboard de Meta)
    //   - eventos especiales (message_edit, read...): entry[].messaging[]
    //     (confirmado con un DM real editado en producción)
    // Se combinan ambos; message_edit/read se descartan por no ser mensajes.
    type Event = Parameters<typeof processMessengerEvent>[0] & {
      message_edit?: unknown;
      read?: unknown;
    };
    type MsgEntry = {
      messaging?: Event[];
      changes?: { field?: string; value?: Event }[];
    };
    const channel = payload.object === "instagram" ? "instagram" : "messenger";
    for (const entry of (payload.entry ?? []) as MsgEntry[]) {
      const events: Event[] = [...(entry.messaging ?? [])];
      if (channel === "instagram") {
        for (const change of entry.changes ?? []) {
          if (change.field === "messages" && change.value) {
            events.push(change.value);
          }
        }
      }
      for (const event of events) {
        if (event.message_edit || event.read) continue; // no son mensajes nuevos
        if (channel === "instagram") {
          await processInstagramValue(event);
        } else {
          await processMessengerEvent(event);
        }
      }
    }
    return;
  }
  // Default: WhatsApp Business Account (formato histórico).
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (!change.value) continue;
      if (change.field === "messages") {
        await processMessagesValue(change.value);
      } else if (change.field === "message_template_status_update") {
        await processTemplateStatusValue(entry.id ?? null, change.value);
      }
      // otros fields: ignorar sin error
    }
  }
}
