import { withAuth } from "@/lib/api";
import { listOpenTriage } from "@/server/salud/triage";
import { agendaGate } from "@/server/salud/panel";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const gate = agendaGate();
  if (gate) return gate;
  const rows = await listOpenTriage(session.organizationId);
  return Response.json({
    triage: rows.map((r) => ({
      id: r.event.id,
      level: r.event.level,
      reason: r.event.reason,
      contactId: r.event.contactId,
      contactName: r.contactName,
      conversationId: r.event.conversationId,
      createdAt: r.event.createdAt.toISOString(),
    })),
  });
});
