import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { BookingError } from "@/server/agenda/service";

/** 070 — Cambios manuales del equipo sobre una cita: confirmación y seña. */

async function own(organizationId: string, bookingId: string) {
  const rows = await getDb()
    .select()
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(eq(schema.booking.id, bookingId), eq(schema.booking.kind, "session"))
      )
    )
    .limit(1);
  if (!rows[0]) throw new BookingError("not_found", "Cita no encontrada");
  return rows[0];
}

export async function setBookingConfirmation(input: {
  organizationId: string;
  bookingId: string;
  confirmation: "pendiente" | "confirmada";
}): Promise<void> {
  const b = await own(input.organizationId, input.bookingId);
  if (b.status === "cancelada") {
    throw new BookingError("invalid", "La cita está cancelada");
  }
  await getDb()
    .update(schema.booking)
    .set({
      confirmation: input.confirmation,
      confirmedAt: input.confirmation === "confirmada" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.booking.id, b.id));
  publish(input.organizationId, {
    type: "booking.updated",
    data: { bookingId: b.id },
  });
}

export async function setBookingDeposit(input: {
  organizationId: string;
  bookingId: string;
  depositStatus: "pendiente" | "pagada";
}): Promise<void> {
  const b = await own(input.organizationId, input.bookingId);
  if (b.depositStatus === "no_aplica") {
    throw new BookingError("invalid", "Este turno no tiene seña");
  }
  await getDb()
    .update(schema.booking)
    .set({
      depositStatus: input.depositStatus,
      // La seña paga deja el turno confirmado: es la señal más fuerte que hay.
      ...(input.depositStatus === "pagada" && b.confirmation === "pendiente"
        ? { confirmation: "confirmada" as const, confirmedAt: new Date() }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.booking.id, b.id));
  publish(input.organizationId, {
    type: "booking.updated",
    data: { bookingId: b.id },
  });
}
