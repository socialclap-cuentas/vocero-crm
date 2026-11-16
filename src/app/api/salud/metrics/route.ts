import { apiError, withAuth } from "@/lib/api";
import { parseRangeQuery } from "@/lib/time/calendar";
import { getHealthMetrics } from "@/server/salud/metrics";
import { agendaGate } from "@/server/salud/panel";

export const dynamic = "force-dynamic";

/** Sin parámetros, los últimos 30 días. Con `?from=&to=` (AAAA-MM-DD, máx. 92 días), ese rango. */
export const GET = withAuth(async (session, req: Request) => {
  const gate = agendaGate();
  if (gate) return gate;
  const url = new URL(req.url);
  const q = parseRangeQuery(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!q.ok) return apiError(422, "invalid_range", q.message);
  return Response.json(
    await getHealthMetrics(
      session.organizationId,
      q.range ? { from: q.range.from, to: q.range.to } : undefined
    )
  );
});
