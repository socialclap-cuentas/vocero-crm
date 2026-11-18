/**
 * Modo demo: la instancia que se le muestra a un prospecto.
 *
 * Misma decisión que la agenda y los canales opcionales (ADR-001): lo decide
 * una variable de despliegue, apagada por defecto. Una instalación normal no
 * la tiene y no cambia en nada.
 *
 * Encendida, la instancia esconde y bloquea lo técnico (conexión de
 * WhatsApp, llaves de IA, guía de inicio, equipo, marca): para quien mira es
 * ruido, y para quien la comparte es una puerta que no debería poder tocar.
 * El agente y el Laboratorio siguen funcionando: son lo que se quiere ver.
 */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseDemoFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

export function demoMode(): boolean {
  return parseDemoFlag(process.env.DEMO_MODE);
}

/**
 * Rutas que la demo no ofrece. Páginas y API van juntas: esconder el enlace
 * sin bloquear la ruta dejaría la pantalla a un clic de la barra de direcciones.
 */
const BLOQUEADAS = [
  /^\/onboarding(\/|$)/,
  /^\/settings\/(whatsapp|ai|channels|instagram|messenger|tiktok|team|branding|ads)(\/|$)/,
  /^\/api\/settings\/(whatsapp|ai|webhook|capi|channels|instagram|messenger|tiktok|team|branding|google|zoom|ads)(\/|$)/,
  /^\/api\/onboarding(\/|$)/,
];

export function rutaBloqueadaEnDemo(pathname: string): boolean {
  return BLOQUEADAS.some((re) => re.test(pathname));
}
