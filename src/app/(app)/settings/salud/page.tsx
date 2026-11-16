import { notFound } from "next/navigation";
import { SaludClient } from "@/components/settings/salud-client";
import { agendaEnabled } from "@/server/agenda/flag";

export const dynamic = "force-dynamic";

export default function SaludSettingsPage() {
  // 070 — Vive sobre la agenda: sin la bandera esta pantalla no existe.
  if (!agendaEnabled()) notFound();
  return <SaludClient />;
}
