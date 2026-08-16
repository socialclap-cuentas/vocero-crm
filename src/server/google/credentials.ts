import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

export type GoogleCredentials = {
  id: string;
  organizationId: string;
  googleEmail: string | null;
  calendarId: string;
  status: "connected" | "reconnect_required";
  refreshToken: string;
};

type Row = typeof schema.googleCredentials.$inferSelect;

function toCredentials(row: Row): GoogleCredentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    googleEmail: row.googleEmail,
    calendarId: row.calendarId,
    status: row.status,
    refreshToken: decryptSecret({
      cipher: row.refreshTokenCipher,
      iv: row.refreshTokenIv,
      tag: row.refreshTokenTag,
    }),
  };
}

export async function getGoogleCredentialsByOrg(
  organizationId: string
): Promise<GoogleCredentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.googleCredentials)
    .where(scoped(schema.googleCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveGoogleCredentials(input: {
  organizationId: string;
  refreshToken: string;
  googleEmail?: string | null;
  calendarId?: string;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.refreshToken);
  await db
    .insert(schema.googleCredentials)
    .values({
      id: newId("googleCredentials"),
      organizationId: input.organizationId,
      googleEmail: input.googleEmail ?? null,
      calendarId: input.calendarId ?? "primary",
      refreshTokenCipher: enc.cipher,
      refreshTokenIv: enc.iv,
      refreshTokenTag: enc.tag,
      status: "connected",
    })
    .onConflictDoUpdate({
      target: [schema.googleCredentials.organizationId],
      set: {
        googleEmail: input.googleEmail ?? null,
        calendarId: input.calendarId ?? "primary",
        refreshTokenCipher: enc.cipher,
        refreshTokenIv: enc.iv,
        refreshTokenTag: enc.tag,
        status: "connected",
        updatedAt: new Date(),
      },
    });
}

export async function markGoogleReconnectRequired(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.googleCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.googleCredentials.organizationId, organizationId));
}

export async function disconnectGoogle(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.googleCredentials)
    .where(eq(schema.googleCredentials.organizationId, organizationId));
}
