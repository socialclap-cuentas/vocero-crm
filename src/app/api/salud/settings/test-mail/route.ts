import { withAuth } from "@/lib/api";
import { agendaGate } from "@/server/salud/panel";
import { enviarCorreoDePrueba } from "@/server/salud/avisos-correo";

export const dynamic = "force-dynamic";

const MENSAJE: Record<string, string> = {
  sin_destinatarios: "Cargá y guardá al menos un correo antes de probar.",
  apagado: "El envío de correos todavía no está activado en esta instalación.",
  rechazado: "El servicio de correo rechazó el envío",
  sin_conexion: "No se pudo conectar con el servicio de correo.",
};

/** 071 — «Enviar correo de prueba»: manda un mail real a los correos guardados. */
export const POST = withAuth(async (session) => {
  const gate = agendaGate();
  if (gate) return gate;
  const r = await enviarCorreoDePrueba(session.organizationId);
  if (r.ok) return Response.json({ ok: true });
  const base = MENSAJE[r.motivo] ?? "No se pudo enviar";
  const detalle = "detalle" in r && r.detalle ? `: ${r.detalle}` : "";
  return Response.json({ ok: false, message: `${base}${detalle}` });
});
