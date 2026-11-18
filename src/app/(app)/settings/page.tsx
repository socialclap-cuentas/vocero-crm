import { redirect } from "next/navigation";
import { demoMode } from "@/server/demo/flag";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  // En la demo no hay pantalla de WhatsApp: la entrada es la agenda.
  redirect(demoMode() ? "/settings/calendar" : "/settings/whatsapp");
}
