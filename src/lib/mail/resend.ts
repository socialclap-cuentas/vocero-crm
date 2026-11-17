import { getEnv } from "@/lib/env";

/**
 * 071 — Conector OPCIONAL de correo (Resend), por REST directo: sin SDK ni
 * dependencias nuevas (constitución II.3, igual que el conector de Google).
 *
 * Apagado por defecto: sin `RESEND_API_KEY` y `MAIL_FROM` no se manda nada y
 * la instancia funciona igual. Nunca lanza: un correo que falla no puede
 * tumbar una cita ni una urgencia (degradación definida: se registra y sigue).
 */

export type Correo = {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
};

export type ResultadoCorreo =
  | { ok: true; id: string | null }
  | { ok: false; motivo: "apagado" | "rechazado" | "sin_conexion"; detalle?: string };

const TIMEOUT_MS = 8000;

/** ¿Está el conector encendido? (la llave y el remitente, juntos). */
export function correoConfigurado(): boolean {
  const e = getEnv();
  return Boolean(e.RESEND_API_KEY?.trim() && e.MAIL_FROM?.trim());
}

export async function enviarCorreo(c: Correo): Promise<ResultadoCorreo> {
  const e = getEnv();
  if (!correoConfigurado() || c.to.length === 0) return { ok: false, motivo: "apagado" };
  try {
    const res = await fetch(`${e.RESEND_BASE_URL}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${e.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: e.MAIL_FROM,
        to: c.to,
        subject: c.subject,
        text: c.text,
        html: c.html,
        ...(c.replyTo ? { reply_to: c.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // El cuerpo de Resend explica el rechazo (dominio sin verificar, etc.);
      // se devuelve para mostrarlo en «Enviar correo de prueba». Jamás la llave.
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, motivo: "rechazado", detalle: body?.message ?? `HTTP ${res.status}` };
    }
    const data = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: data?.id ?? null };
  } catch (err) {
    return {
      ok: false,
      motivo: "sin_conexion",
      detalle: err instanceof Error ? err.name : "error",
    };
  }
}
