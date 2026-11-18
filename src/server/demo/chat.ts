import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import {
  getOrCreateConversation,
  ingestInboundMessage,
} from "@/server/inbox/ingest";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";

/**
 * Sala de chat de la demo: el prospecto escribe como si fuera el paciente.
 *
 * No hay WhatsApp detrás. El mensaje entra por la MISMA ingesta que uno real
 * (pipeline, etiquetas, despacho al cerebro), así que el agente contesta y
 * mueve la ficha, las notas y la agenda igual que en producción. Lo único
 * distinto es la salida: con DEMO_MODE el envío no sale a ningún lado, queda
 * en el hilo (ver `sendText`).
 *
 * Vive solo con la bandera encendida; las rutas responden 404 si no.
 */

/** Los teléfonos de la demo. Un solo prefijo para reconocerlos en la bandeja. */
export const DEMO_PHONE_PREFIX = "5491199";

export function esConversacionDeDemo(phone: string | null): boolean {
  return !!phone && phone.startsWith(DEMO_PHONE_PREFIX);
}

function telefonoDeDemo(): string {
  const n = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `${DEMO_PHONE_PREFIX}${n}`;
}

/** Una conversación nueva con un paciente de prueba, lista para escribirle. */
export async function nuevaSalaDeDemo(
  organizationId: string
): Promise<{ conversationId: string }> {
  const telefono = telefonoDeDemo();
  const { contact } = await getOrCreateContactByIdentity(organizationId, {
    identity: telefono,
    phone: telefono,
    waUserId: null,
    profileName: "Paciente de prueba",
  });
  const conversation = await getOrCreateConversation(organizationId, contact.id);
  return { conversationId: conversation.id };
}

export class SalaDemoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** El paciente de prueba escribe: entra como un mensaje entrante cualquiera. */
export async function escribirComoPaciente(
  organizationId: string,
  conversationId: string,
  text: string
): Promise<void> {
  const db = getDb();
  const [fila] = await db
    .select({ phone: schema.contact.phone, waIdentity: schema.contact.waIdentity })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(eq(schema.conversation.id, conversationId))
      )
    )
    .limit(1);
  // Solo los pacientes de la sala: esta ruta no puede hablar por un contacto real.
  if (!fila || !esConversacionDeDemo(fila.phone)) {
    throw new SalaDemoError(404, "not_found", "Conversación no encontrada");
  }
  await ingestInboundMessage({
    organizationId,
    identity: {
      identity: fila.waIdentity,
      phone: fila.phone,
      waUserId: null,
      profileName: null,
    },
    waMessageId: newId("message"),
    type: "text",
    text,
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
}
