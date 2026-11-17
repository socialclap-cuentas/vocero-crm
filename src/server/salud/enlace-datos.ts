import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { SaludError } from "@/server/salud/catalog";
import {
  normalizeBirthDate,
  normalizeDocument,
  upsertPatient,
} from "@/server/salud/patient";

/**
 * 071 — Enlace de un solo uso para completar el documento FUERA del chat.
 *
 * WhatsApp prohíbe pedir números de documento por el chat, así que el agente
 * manda un enlace a una página del propio CRM. El token viaja solo en la URL;
 * en la base queda su hash. Vence a las 24 h y se consume una sola vez.
 */

export const DATA_LINK_TTL_MS = 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** PURA: 32 caracteres url-safe, sin relleno. */
export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** PURA: un token con forma válida (evita ir a la base con basura). */
export function looksLikeToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(t);
}

/** PURA: link absoluto a la página pública. */
export function dataLinkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/datos/${token}`;
}

/** PURA: wa.me con un texto ya escrito; null si no hay un número usable. */
export function whatsappReturnUrl(
  displayPhone: string | null | undefined,
  text: string
): string | null {
  const digits = (displayPhone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export const RETURN_TEXT = "Listo, ya completé mis datos";

export async function createDataLink(
  organizationId: string,
  contactId: string,
  conversationId: string | null,
  baseUrl: string,
  now: Date = new Date()
): Promise<{ url: string; expiresAt: string }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + DATA_LINK_TTL_MS);
  await getDb()
    .insert(schema.patientDataLink)
    .values({
      id: newId("dataLink"),
      organizationId,
      contactId,
      conversationId,
      tokenHash: hashToken(token),
      expiresAt,
    });
  return { url: dataLinkUrl(baseUrl, token), expiresAt: expiresAt.toISOString() };
}

export type DataLinkView =
  | { state: "invalid" | "expired" | "used" }
  | {
      state: "ok";
      businessName: string;
      contactName: string | null;
      insuranceName: string | null;
      whatsappUrl: string | null;
    };

type LinkRow = typeof schema.patientDataLink.$inferSelect;

async function findLink(token: string): Promise<LinkRow | null> {
  if (!looksLikeToken(token)) return null;
  const rows = await getDb()
    .select()
    .from(schema.patientDataLink)
    .where(eq(schema.patientDataLink.tokenHash, hashToken(token)))
    .limit(1);
  return rows[0] ?? null;
}

export async function viewDataLink(
  token: string,
  now: Date = new Date()
): Promise<DataLinkView> {
  const link = await findLink(token);
  if (!link) return { state: "invalid" };
  if (link.usedAt) return { state: "used" };
  if (link.expiresAt.getTime() <= now.getTime()) return { state: "expired" };

  const db = getDb();
  const org = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, link.organizationId))
    .limit(1);
  const ct = await db
    .select({ name: schema.contact.name })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        link.organizationId,
        eq(schema.contact.id, link.contactId)
      )
    )
    .limit(1);
  const ins = await db
    .select({ name: schema.insurance.name })
    .from(schema.patientProfile)
    .innerJoin(
      schema.insurance,
      eq(schema.insurance.id, schema.patientProfile.insuranceId)
    )
    .where(
      scoped(
        schema.patientProfile.organizationId,
        link.organizationId,
        eq(schema.patientProfile.contactId, link.contactId)
      )
    )
    .limit(1);
  const wa = await db
    .select({ phone: schema.metaCredentials.displayPhoneNumber })
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.organizationId, link.organizationId))
    .limit(1);

  return {
    state: "ok",
    businessName: org[0]?.name ?? "el consultorio",
    contactName: ct[0]?.name ?? null,
    insuranceName: ins[0]?.name ?? null,
    whatsappUrl: whatsappReturnUrl(wa[0]?.phone, RETURN_TEXT),
  };
}

export type DataLinkInput = {
  documentNumber: string;
  birthDate?: string | null;
  affiliateNumber?: string | null;
};

/**
 * Guarda los datos en la ficha y consume el enlace. Valida ANTES de consumir
 * (un DNI mal tipeado no quema el enlace) y reclama con un UPDATE atómico:
 * dos envíos a la vez no pueden pasar los dos.
 */
export async function submitDataLink(
  token: string,
  input: DataLinkInput,
  now: Date = new Date()
): Promise<void> {
  const documentNumber = normalizeDocument(input.documentNumber);
  if (!documentNumber) throw new SaludError("invalid", "Falta el documento");
  const birthDate = normalizeBirthDate(input.birthDate, now);

  const link = await findLink(token);
  if (!link) throw new SaludError("not_found", "Enlace inválido");
  if (link.usedAt) throw new SaludError("conflict", "Este enlace ya se usó");
  if (link.expiresAt.getTime() <= now.getTime())
    throw new SaludError("conflict", "El enlace venció");

  const db = getDb();
  const claimed = await db
    .update(schema.patientDataLink)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.patientDataLink.id, link.id),
        isNull(schema.patientDataLink.usedAt),
        gt(schema.patientDataLink.expiresAt, now)
      )
    )
    .returning({ id: schema.patientDataLink.id });
  if (!claimed[0]) throw new SaludError("conflict", "Este enlace ya se usó");

  try {
    await upsertPatient(
      link.organizationId,
      link.contactId,
      {
        documentNumber,
        ...(birthDate ? { birthDate } : {}),
        ...(input.affiliateNumber ? { affiliateNumber: input.affiliateNumber } : {}),
      },
      now
    );
  } catch (err) {
    // Si no se pudo guardar, el enlace no se pierde.
    await db
      .update(schema.patientDataLink)
      .set({ usedAt: null })
      .where(eq(schema.patientDataLink.id, link.id));
    throw err;
  }
}
