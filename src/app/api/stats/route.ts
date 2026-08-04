import { asc, eq, gte, lt, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/**
 * Estadísticas del CRM para un mes dado (default: mes actual).
 * Query param opcional: ?month=YYYY-MM
 *
 * Devuelve:
 * - funnel: leads agrupados por etapa actual (snapshot de hoy, no del mes)
 * - dailyVolume: mensajes entrantes reales por día del mes (excluye Laboratorio)
 * - handoffRate: % de conversaciones del mes que escalaron a humano
 * - totals: consultas del mes, leads nuevos del mes, tasa de conversión a "won"
 */
export const GET = withAuth(async (session, req: Request) => {
  const db = getDb();
  const { searchParams } = new URL(req.url);

  const monthParam = searchParams.get("month"); // "YYYY-MM"
  const now = new Date();
  const year = monthParam ? Number(monthParam.split("-")[0]) : now.getFullYear();
  const month = monthParam ? Number(monthParam.split("-")[1]) - 1 : now.getMonth();

  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 1));

  // ---- Embudo: snapshot actual de leads por etapa (todas las etapas abiertas) ----
  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const funnelRows = await db
    .select({
      stageId: schema.lead.stageId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.lead)
    .where(scoped(schema.lead.organizationId, session.organizationId))
    .groupBy(schema.lead.stageId);

  const funnelByStage = new Map(funnelRows.map((r) => [r.stageId, r.count]));
  const funnel = stages.map((s) => ({
    stageId: s.id,
    name: s.name,
    kind: s.kind,
    count: funnelByStage.get(s.id) ?? 0,
  }));

  const totalLeads = funnel.reduce((a, f) => a + f.count, 0);
  const wonCount = funnel.filter((f) => f.kind === "won").reduce((a, f) => a + f.count, 0);
  const conversionRate = totalLeads > 0 ? Math.round((wonCount / totalLeads) * 1000) / 10 : 0;

  // ---- Volumen diario de mensajes entrantes reales (sin Laboratorio) en el mes ----
  const dailyVolumeRows = await db
    .select({
      day: sql<string>`to_char(${schema.message.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.message)
    .innerJoin(schema.conversation, eq(schema.message.conversationId, schema.conversation.id))
    .where(
      scoped(
        schema.message.organizationId,
        session.organizationId,
        eq(schema.message.direction, "in"),
        eq(schema.conversation.isTest, false),
        gte(schema.message.createdAt, monthStart),
        lt(schema.message.createdAt, monthEnd)
      )
    )
    .groupBy(sql`to_char(${schema.message.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${schema.message.createdAt}, 'YYYY-MM-DD')`);

  // ---- Tasa de handoff (conversaciones del mes que escalaron a humano) ----
  const convStatsRows = await db
    .select({
      total: sql<number>`count(*)::int`,
      handoff: sql<number>`count(*) filter (where ${schema.conversation.handoffAt} is not null)::int`,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        session.organizationId,
        eq(schema.conversation.isTest, false),
        gte(schema.conversation.createdAt, monthStart),
        lt(schema.conversation.createdAt, monthEnd)
      )
    );

  const convStats = convStatsRows[0] ?? { total: 0, handoff: 0 };
  const handoffRate =
    convStats.total > 0 ? Math.round((convStats.handoff / convStats.total) * 1000) / 10 : 0;

  // ---- Leads nuevos creados en el mes ----
  const newLeadsRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        session.organizationId,
        gte(schema.lead.createdAt, monthStart),
        lt(schema.lead.createdAt, monthEnd)
      )
    );

  return Response.json({
    month: `${year}-${String(month + 1).padStart(2, "0")}`,
    funnel,
    dailyVolume: dailyVolumeRows,
    totals: {
      leadsActivos: totalLeads,
      leadsNuevosDelMes: newLeadsRows[0]?.count ?? 0,
      conversacionesDelMes: convStats.total,
      tasaHandoff: handoffRate,
      tasaConversion: conversionRate,
    },
  });
});
