import { notFound } from "next/navigation";
import { ConsultorioClient } from "@/components/salud/consultorio-client";
import { agendaEnabled } from "@/server/agenda/flag";

export const dynamic = "force-dynamic";

export default function ConsultorioPage() {
  if (!agendaEnabled()) notFound();
  return <ConsultorioClient />;
}
