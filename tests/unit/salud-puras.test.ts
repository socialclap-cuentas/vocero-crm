import { describe, expect, it, vi } from "vitest";

/**
 * 070 — Funciones puras del vertical salud: sin BD ni red. Lo que se fija acá
 * son las reglas que, si cambian sin querer, le mandan un mensaje de más (o de
 * menos) a un paciente.
 */

vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("@/server/events/bus", () => ({ publish: () => {} }));

import { detectUrgency, normalizeText } from "@/server/salud/triage";
import { planReminders } from "@/server/salud/reminders";
import { parseScore, surveyDue } from "@/server/salud/survey";
import { reactivationDue } from "@/server/salud/reactivation";
import { entryMatchesSlot, firstName } from "@/server/salud/waitlist";
import { normalizeBirthDate, normalizeDocument } from "@/server/salud/patient";
import { normalizeLeadHours } from "@/server/salud/settings";

const H = 3_600_000;
const at = (iso: string) => new Date(iso);

describe("triage — detectUrgency", () => {
  it("normaliza tildes, mayúsculas y espacios", () => {
    expect(normalizeText("  Dolor   de PECHO  ")).toBe("dolor de pecho");
    expect(normalizeText("Hemorragia ÁÉÍ")).toBe("hemorragia aei");
  });

  it("riesgo vital → urgente", () => {
    expect(detectUrgency("tengo dolor de pecho")?.level).toBe("urgente");
    expect(detectUrgency("NO PUEDO RESPIRAR")?.level).toBe("urgente");
    expect(detectUrgency("mi hijo tuvo una convulsión")?.level).toBe("urgente");
    expect(detectUrgency("no para de sangrar")?.level).toBe("urgente");
    expect(detectUrgency("me quiero morir")?.level).toBe("urgente");
  });

  it("importante pero no vital → prioritario", () => {
    expect(detectUrgency("tengo un dolor muy fuerte en la muela")?.level).toBe("prioritario");
    expect(detectUrgency("se me cayó una corona")?.level).toBe("prioritario");
    expect(detectUrgency("es una urgencia")?.level).toBe("prioritario");
    expect(detectUrgency("tengo fiebre alta")?.level).toBe("prioritario");
  });

  it("un mensaje normal no dispara nada", () => {
    expect(detectUrgency("hola, quiero sacar turno para una limpieza")).toBeNull();
    expect(detectUrgency("¿atienden por OSDE?")).toBeNull();
    expect(detectUrgency("")).toBeNull();
    expect(detectUrgency(null)).toBeNull();
  });

  it("la negación simple NO la desactiva: decide una persona", () => {
    expect(detectUrgency("no tengo dolor de pecho")?.level).toBe("urgente");
  });

  it("palabras del consultorio → prioritario; nunca pisan a una vital", () => {
    expect(detectUrgency("me salió un bulto", "bulto\nquiste")?.level).toBe("prioritario");
    expect(detectUrgency("no puedo respirar", "bulto")?.level).toBe("urgente");
    expect(detectUrgency("hola", "bulto")).toBeNull();
    // Palabras de menos de 3 letras se ignoran (ruido).
    expect(detectUrgency("hola ok", "ok")).toBeNull();
  });
});

describe("recordatorios — planReminders", () => {
  const scheduledAt = at("2026-12-10T15:00:00Z");
  const base = {
    scheduledAt,
    createdAt: at("2026-12-01T12:00:00Z"),
    reminderFirstAt: null,
    reminderSecondAt: null,
    leadHours: [48, 2],
  };

  it("antes de la hora del primer aviso, nada", () => {
    const p = planReminders({ ...base, now: new Date(scheduledAt.getTime() - 49 * H) });
    expect(p).toEqual({ send: null, skip: [] });
  });

  it("llegada la hora del primero, manda el primero", () => {
    const p = planReminders({ ...base, now: new Date(scheduledAt.getTime() - 47 * H) });
    expect(p.send).toBe("first");
  });

  it("con el primero ya enviado, espera al segundo", () => {
    const first = new Date(scheduledAt.getTime() - 47 * H);
    expect(
      planReminders({ ...base, reminderFirstAt: first, now: new Date(scheduledAt.getTime() - 10 * H) }).send
    ).toBeNull();
    expect(
      planReminders({ ...base, reminderFirstAt: first, now: new Date(scheduledAt.getTime() - 1.5 * H) }).send
    ).toBe("second");
  });

  it("si vencieron los dos juntos (servidor caído), manda solo el último", () => {
    const p = planReminders({ ...base, now: new Date(scheduledAt.getTime() - 1 * H) });
    expect(p.send).toBe("second");
    expect(p.skip).toContain("first");
  });

  it("reservada DENTRO de la ventana de un aviso: ese aviso se descarta", () => {
    // Reservó 20 h antes: el de 48 h no tiene sentido, el de 2 h sí.
    const created = new Date(scheduledAt.getTime() - 20 * H);
    const early = planReminders({ ...base, createdAt: created, now: new Date(scheduledAt.getTime() - 19 * H) });
    expect(early.send).toBeNull();
    expect(early.skip).toEqual(["first"]);
    const later = planReminders({ ...base, createdAt: created, now: new Date(scheduledAt.getTime() - 1 * H) });
    expect(later.send).toBe("second");
  });

  it("una cita pasada no recibe nada", () => {
    const p = planReminders({ ...base, now: new Date(scheduledAt.getTime() + H) });
    expect(p).toEqual({ send: null, skip: [] });
  });

  it("con una sola hora configurada, un solo aviso", () => {
    const p = planReminders({ ...base, leadHours: [24], now: new Date(scheduledAt.getTime() - 23 * H) });
    expect(p.send).toBe("first");
  });
});

describe("encuesta — surveyDue / parseScore", () => {
  const scheduledAt = at("2026-12-10T15:00:00Z");
  const common = { scheduledAt, durationMinutes: 30, delayHours: 3, surveySentAt: null };

  it("no antes de terminar la cita + demora", () => {
    expect(surveyDue({ ...common, now: at("2026-12-10T17:00:00Z") })).toBe(false);
  });
  it("sí cuando pasó la demora", () => {
    expect(surveyDue({ ...common, now: at("2026-12-10T18:31:00Z") })).toBe(true);
  });
  it("no si ya se mandó", () => {
    expect(surveyDue({ ...common, surveySentAt: at("2026-12-10T19:00:00Z"), now: at("2026-12-10T20:00:00Z") })).toBe(false);
  });
  it("no pasadas 48 h desde que correspondía", () => {
    expect(surveyDue({ ...common, now: at("2026-12-13T00:00:00Z") })).toBe(false);
  });

  it("parseScore acepta 1..5 enteros y nada más", () => {
    expect(parseScore(5)).toBe(5);
    expect(parseScore(" 3 ")).toBe(3);
    expect(parseScore(0)).toBeNull();
    expect(parseScore(6)).toBeNull();
    expect(parseScore(4.5)).toBeNull();
    expect(parseScore("excelente")).toBeNull();
    expect(parseScore(null)).toBeNull();
  });
});

describe("reactivación — reactivationDue", () => {
  const now = at("2026-12-10T12:00:00Z");
  const common = {
    lastVisitAt: at("2026-05-01T12:00:00Z"),
    months: 6,
    reactivationSentAt: null,
    optOut: false,
    hasFutureBooking: false,
    now,
  };

  it("pasaron los meses → corresponde", () => {
    expect(reactivationDue(common)).toBe(true);
  });
  it("todavía no pasaron los meses", () => {
    expect(reactivationDue({ ...common, lastVisitAt: at("2026-09-01T12:00:00Z") })).toBe(false);
  });
  it("quien pidió no recibir seguimientos, nunca", () => {
    expect(reactivationDue({ ...common, optOut: true })).toBe(false);
  });
  it("si ya tiene un turno futuro, no", () => {
    expect(reactivationDue({ ...common, hasFutureBooking: true })).toBe(false);
  });
  it("un solo aviso por visita: no insiste", () => {
    expect(reactivationDue({ ...common, reactivationSentAt: at("2026-11-15T12:00:00Z") })).toBe(false);
  });
  it("si vino de nuevo después del aviso, vuelve a corresponder", () => {
    expect(
      reactivationDue({
        ...common,
        lastVisitAt: at("2026-05-01T12:00:00Z"),
        reactivationSentAt: at("2026-03-01T12:00:00Z"),
      })
    ).toBe(true);
  });
});

describe("lista de espera — entryMatchesSlot", () => {
  const slot = {
    professionalId: "pro_a",
    appointmentTypeId: "apt_x",
    startUtc: at("2026-12-10T15:00:00Z"),
  };
  const entry = { professionalId: null, appointmentTypeId: null, offeredStartUtc: null };

  it("sin preferencias, sirve cualquier hueco", () => {
    expect(entryMatchesSlot(entry, slot)).toBe(true);
  });
  it("respeta el profesional pedido", () => {
    expect(entryMatchesSlot({ ...entry, professionalId: "pro_a" }, slot)).toBe(true);
    expect(entryMatchesSlot({ ...entry, professionalId: "pro_b" }, slot)).toBe(false);
  });
  it("respeta el tipo de turno pedido", () => {
    expect(entryMatchesSlot({ ...entry, appointmentTypeId: "apt_y" }, slot)).toBe(false);
    expect(entryMatchesSlot({ ...entry, appointmentTypeId: "apt_x" }, slot)).toBe(true);
  });
  it("no vuelve a ofrecer el mismo hueco que ya rechazó", () => {
    expect(entryMatchesSlot({ ...entry, offeredStartUtc: slot.startUtc }, slot)).toBe(false);
  });
  it("firstName", () => {
    expect(firstName("  Ana María Pérez ")).toBe("Ana");
    expect(firstName("")).toBe("");
  });
});

describe("ficha del paciente — normalizaciones", () => {
  it("documento: limpia puntos y guiones; rechaza basura", () => {
    expect(normalizeDocument("30.123.456")).toBe("30123456");
    expect(normalizeDocument("  ")).toBeNull();
    expect(normalizeDocument(null)).toBeNull();
    expect(() => normalizeDocument("12")).toThrow();
    expect(() => normalizeDocument("abc!@#def")).toThrow();
  });

  it("nacimiento: fecha real, no futura, desde 1900", () => {
    const now = at("2026-12-10T12:00:00Z");
    expect(normalizeBirthDate("1990-05-17", now)).toBe("1990-05-17");
    expect(normalizeBirthDate("", now)).toBeNull();
    expect(() => normalizeBirthDate("17/05/1990", now)).toThrow();
    expect(() => normalizeBirthDate("1990-02-31", now)).toThrow();
    expect(() => normalizeBirthDate("2030-01-01", now)).toThrow();
    expect(() => normalizeBirthDate("1850-01-01", now)).toThrow();
  });
});

describe("configuración — normalizeLeadHours", () => {
  it("ordena de mayor a menor, sin repetir, máx. 2", () => {
    expect(normalizeLeadHours([2, 48])).toEqual([48, 2]);
    expect(normalizeLeadHours([24, 24])).toEqual([24]);
    expect(normalizeLeadHours([72, 48, 2])).toEqual([72, 48]);
  });
  it("descarta fuera de rango o basura", () => {
    expect(normalizeLeadHours([0, 500, "x"])).toEqual([]);
  });
  it("si no es lista, usa el default", () => {
    expect(normalizeLeadHours("48")).toEqual([48, 2]);
  });
});

describe("appendContactNote", () => {
  it("suma sin pisar lo del equipo y no repite", async () => {
    const { appendContactNote } = await import("@/server/salud/patient");
    expect(appendContactNote(null, "prefiere a la mañana")).toBe("• prefiere a la mañana");
    const uno = appendContactNote("Paga en efectivo", "viene con su hijo");
    expect(uno).toBe("Paga en efectivo\n• viene con su hijo");
    expect(appendContactNote(uno, "Viene con su hijo")).toBeNull();
    expect(appendContactNote("x", "   ")).toBeNull();
  });
});
