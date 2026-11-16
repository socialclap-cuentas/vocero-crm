import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/** 070 — Ajustes del vertical salud (una fila por organización, con defaults). */

export type HealthSettings = {
  reminderLeadHours: number[];
  reminderTemplateId: string | null;
  waitlistEnabled: boolean;
  depositPaymentInfo: string | null;
  surveyEnabled: boolean;
  surveyDelayHours: number;
  surveyTemplateId: string | null;
  reviewUrl: string | null;
  reactivationEnabled: boolean;
  reactivationMonths: number;
  reactivationTemplateId: string | null;
  urgencyMessage: string | null;
  urgencyKeywords: string | null;
};

export const DEFAULT_URGENCY_MESSAGE =
  "Entiendo que es algo urgente. Te paso ahora mismo con una persona del equipo. " +
  "Si sentís que es una emergencia o hay riesgo, llamá al 107 (emergencias médicas) o andá a la guardia más cercana.";

export const DEFAULT_HEALTH_SETTINGS: HealthSettings = {
  reminderLeadHours: [48, 2],
  reminderTemplateId: null,
  waitlistEnabled: true,
  depositPaymentInfo: null,
  surveyEnabled: true,
  surveyDelayHours: 3,
  surveyTemplateId: null,
  reviewUrl: null,
  reactivationEnabled: false,
  reactivationMonths: 6,
  reactivationTemplateId: null,
  urgencyMessage: null,
  urgencyKeywords: null,
};

/** PURA: horas de aviso válidas — enteros 1..336, sin repetir, de mayor a menor, máx. 2. */
export function normalizeLeadHours(input: unknown): number[] {
  if (!Array.isArray(input)) return DEFAULT_HEALTH_SETTINGS.reminderLeadHours;
  const nums = input
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 336);
  const unique = [...new Set(nums)].sort((a, b) => b - a).slice(0, 2);
  return unique;
}

function text(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

function clamp(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

export async function getHealthSettings(
  organizationId: string
): Promise<HealthSettings> {
  const rows = await getDb()
    .select()
    .from(schema.healthSettings)
    .where(scoped(schema.healthSettings.organizationId, organizationId))
    .limit(1);
  const r = rows[0];
  if (!r) return DEFAULT_HEALTH_SETTINGS;
  return {
    reminderLeadHours: normalizeLeadHours(r.reminderLeadHours),
    reminderTemplateId: r.reminderTemplateId,
    waitlistEnabled: r.waitlistEnabled,
    depositPaymentInfo: r.depositPaymentInfo,
    surveyEnabled: r.surveyEnabled,
    surveyDelayHours: r.surveyDelayHours,
    surveyTemplateId: r.surveyTemplateId,
    reviewUrl: r.reviewUrl,
    reactivationEnabled: r.reactivationEnabled,
    reactivationMonths: r.reactivationMonths,
    reactivationTemplateId: r.reactivationTemplateId,
    urgencyMessage: r.urgencyMessage,
    urgencyKeywords: r.urgencyKeywords,
  };
}

export type HealthSettingsInput = {
  [K in keyof HealthSettings]?: HealthSettings[K] | unknown;
};

export async function upsertHealthSettings(
  organizationId: string,
  input: HealthSettingsInput
): Promise<HealthSettings> {
  const cur = await getHealthSettings(organizationId);
  const next: HealthSettings = {
    reminderLeadHours:
      input.reminderLeadHours !== undefined
        ? normalizeLeadHours(input.reminderLeadHours)
        : cur.reminderLeadHours,
    reminderTemplateId:
      input.reminderTemplateId !== undefined
        ? text(input.reminderTemplateId as string | null)
        : cur.reminderTemplateId,
    waitlistEnabled:
      input.waitlistEnabled !== undefined
        ? Boolean(input.waitlistEnabled)
        : cur.waitlistEnabled,
    depositPaymentInfo:
      input.depositPaymentInfo !== undefined
        ? text(input.depositPaymentInfo as string | null)
        : cur.depositPaymentInfo,
    surveyEnabled:
      input.surveyEnabled !== undefined
        ? Boolean(input.surveyEnabled)
        : cur.surveyEnabled,
    surveyDelayHours:
      input.surveyDelayHours !== undefined
        ? clamp(Number(input.surveyDelayHours), 1, 72)
        : cur.surveyDelayHours,
    surveyTemplateId:
      input.surveyTemplateId !== undefined
        ? text(input.surveyTemplateId as string | null)
        : cur.surveyTemplateId,
    reviewUrl:
      input.reviewUrl !== undefined
        ? text(input.reviewUrl as string | null)
        : cur.reviewUrl,
    reactivationEnabled:
      input.reactivationEnabled !== undefined
        ? Boolean(input.reactivationEnabled)
        : cur.reactivationEnabled,
    reactivationMonths:
      input.reactivationMonths !== undefined
        ? clamp(Number(input.reactivationMonths), 1, 36)
        : cur.reactivationMonths,
    reactivationTemplateId:
      input.reactivationTemplateId !== undefined
        ? text(input.reactivationTemplateId as string | null)
        : cur.reactivationTemplateId,
    urgencyMessage:
      input.urgencyMessage !== undefined
        ? text(input.urgencyMessage as string | null)
        : cur.urgencyMessage,
    urgencyKeywords:
      input.urgencyKeywords !== undefined
        ? text(input.urgencyKeywords as string | null)
        : cur.urgencyKeywords,
  };
  const values = { ...next, updatedAt: new Date() };
  await getDb()
    .insert(schema.healthSettings)
    .values({ id: newId("healthSettings"), organizationId, ...values })
    .onConflictDoUpdate({
      target: schema.healthSettings.organizationId,
      set: values,
    });
  return next;
}
