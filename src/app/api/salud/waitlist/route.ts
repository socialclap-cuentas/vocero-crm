import { withAuth } from "@/lib/api";
import { listWaitlist } from "@/server/salud/waitlist";
import { agendaGate } from "@/server/salud/panel";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const gate = agendaGate();
  if (gate) return gate;
  const rows = await listWaitlist(session.organizationId);
  return Response.json({
    waitlist: rows
      .filter((r) => r.entry.status === "waiting" || r.entry.status === "offered")
      .map((r) => ({
        id: r.entry.id,
        contactId: r.entry.contactId,
        contactName: r.contactName,
        professionalId: r.entry.professionalId,
        appointmentTypeId: r.entry.appointmentTypeId,
        preferences: r.entry.preferences,
        status: r.entry.status,
        createdAt: r.entry.createdAt.toISOString(),
      })),
  });
});
