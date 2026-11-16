import { z } from "zod";

/** 070 — Esquemas de entrada del panel (fuera de los route.ts: Next solo admite handlers como exports). */

export const professionalBody = z.object({
  name: z.string().min(1).max(120),
  specialty: z.string().max(120).nullish(),
  color: z.string().max(20).nullish(),
  active: z.boolean().optional(),
  weeklyHours: z
    .record(z.string(), z.array(z.object({ start: z.string(), end: z.string() })))
    .nullish(),
  slotMinutes: z.number().nullish(),
  bufferMinutes: z.number().nullish(),
  meetingLink: z.string().max(500).nullish(),
  sortOrder: z.number().int().optional(),
  appointmentTypeIds: z.array(z.string()).optional(),
  insurances: z
    .array(z.object({ insuranceId: z.string(), copay: z.string().max(200).nullish() }))
    .optional(),
});

export const typeBody = z.object({
  name: z.string().min(1).max(120),
  durationMinutes: z.number().int().min(5).max(480),
  price: z.number().nullish(),
  prepNotes: z.string().max(500).nullish(),
  depositAmount: z.number().nullish(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const insuranceBody = z.object({
  name: z.string().min(1).max(120),
  notes: z.string().max(500).nullish(),
  active: z.boolean().optional(),
});
