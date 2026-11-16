import { sweepReactivation } from "@/server/salud/reactivation";
import { sweepReminders } from "@/server/salud/reminders";
import { sweepSurveys } from "@/server/salud/survey";
import { sweepWaitlist } from "@/server/salud/waitlist";
import { agendaEnabled } from "@/server/agenda/flag";

/**
 * 070 — El barrido del vertical salud, dentro del proceso (como el resto del
 * trabajo de fondo del repo: sin colas externas). Cada minuto: recordatorios,
 * encuestas y vencimiento de ofertas de la lista de espera; cada hora, la
 * reactivación de pacientes.
 *
 * Es seguro ante reinicios: cada paso se marca en la base ANTES de enviar, así
 * que un reinicio a mitad no duplica mensajes ni los pierde en silencio.
 * Solo corre con la agenda encendida.
 */

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

type Estado = { timer: NodeJS.Timeout | null; corriendo: boolean; ultimaHora: number };
const estado: Estado = { timer: null, corriendo: false, ultimaHora: 0 };

async function tick(): Promise<void> {
  if (estado.corriendo) return;
  estado.corriendo = true;
  try {
    const now = new Date();
    const results = await Promise.allSettled([
      sweepReminders(now),
      sweepSurveys(now),
      sweepWaitlist(now),
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[salud] barrido falló:", r.reason);
      }
    }
    if (now.getTime() - estado.ultimaHora >= HORA) {
      estado.ultimaHora = now.getTime();
      await sweepReactivation(now).catch((err) =>
        console.error("[salud] reactivación falló:", err)
      );
    }
  } finally {
    estado.corriendo = false;
  }
}

export function resumeSalud(): void {
  if (!agendaEnabled()) return;
  if (estado.timer) return;
  estado.timer = setInterval(() => void tick(), MINUTO);
  // No retiene el proceso vivo por sí solo.
  estado.timer.unref?.();
  console.log("[boot] vertical salud: recordatorios, encuestas y lista de espera activos");
}

/** Para pruebas. */
export function stopSalud(): void {
  if (estado.timer) clearInterval(estado.timer);
  estado.timer = null;
}
