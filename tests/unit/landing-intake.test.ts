import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("@/server/inbox/identity", () => ({ getOrCreateContactByIdentity: vi.fn() }));
vi.mock("@/server/bot/ficha", () => ({ upsertFicha: vi.fn() }));
vi.mock("@/server/inbox/lead-activity", () => ({ onLeadActivity: vi.fn() }));

import {
  LANDING_ORIGIN,
  buildFichaPatch,
  landingLeadSchema,
  requireIntakeKey,
} from "@/server/leads/landing-intake";

const valid = {
  nombre: "Laura",
  apellido: "Gómez",
  telefono: "5491133346776",
  email: "Laura@Gmail.com",
  rubro: "Odontología",
  consultas_por_dia: "10 a 30",
};

afterEach(() => vi.unstubAllEnvs());

describe("landingLeadSchema", () => {
  it("acepta un registro válido y normaliza el correo", () => {
    const r = landingLeadSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("laura@gmail.com");
  });

  it("rechaza teléfonos que no son WhatsApp móvil argentino (549 + 10 dígitos)", () => {
    for (const telefono of ["1133346776", "541133346776", "54911334677", "+5491133346776", "5491133346776 "]) {
      const r = landingLeadSchema.safeParse({ ...valid, telefono });
      // el último se recorta (trim) y es válido; los demás no
      expect(r.success).toBe(telefono === "5491133346776 ");
    }
  });

  it("rechaza correo inválido y campos vacíos", () => {
    expect(landingLeadSchema.safeParse({ ...valid, email: "laura@" }).success).toBe(false);
    expect(landingLeadSchema.safeParse({ ...valid, nombre: "  " }).success).toBe(false);
  });

  it("limpia caracteres de marcado en los textos", () => {
    const r = landingLeadSchema.safeParse({ ...valid, nombre: "<b>Laura</b>" });
    expect(r.success && r.data.nombre).toBe("b Laura /b");
  });
});

describe("buildFichaPatch", () => {
  const lead = landingLeadSchema.parse(valid);
  const now = new Date("2026-11-18T12:00:00Z");

  it("persona nueva: guarda origen formulario landing y sus datos", () => {
    const f = buildFichaPatch(lead, null, now);
    expect(f.origen).toBe(LANDING_ORIGIN);
    expect(f).toMatchObject({ nombre: "Laura", apellido: "Gómez", rubro: "Odontología", email: "laura@gmail.com" });
  });

  it("persona que ya tenía origen: no se lo pisa; los datos del formulario sí se actualizan", () => {
    const f = buildFichaPatch(lead, { origen: "whatsapp directo", zona: "Almagro", email: "viejo@x.com" }, now);
    expect("origen" in f).toBe(false); // el merge conserva el que ya tenía
    expect("zona" in f).toBe(false); // no toca lo que ya estaba cargado
    expect(f.email).toBe("laura@gmail.com");
  });

  it("persona sin origen cargado (escribió antes, sin ficha): queda con origen formulario landing", () => {
    expect(buildFichaPatch(lead, { zona: "Almagro" }, now).origen).toBe(LANDING_ORIGIN);
  });
});

describe("requireIntakeKey", () => {
  const req = (key?: string) =>
    new Request("http://x/api/public/lead", { method: "POST", headers: key ? { "x-intake-key": key } : {} });

  it("sin LANDING_INTAKE_KEY configurada → 401", () => {
    vi.stubEnv("LANDING_INTAKE_KEY", "");
    expect(requireIntakeKey(req("lo-que-sea-1234567890"))?.status).toBe(401);
  });

  it("clave incorrecta o ausente → 401; correcta → pasa", () => {
    vi.stubEnv("LANDING_INTAKE_KEY", "clave-de-prueba-larga-123");
    expect(requireIntakeKey(req())?.status).toBe(401);
    expect(requireIntakeKey(req("otra-clave-distinta-1234"))?.status).toBe(401);
    expect(requireIntakeKey(req("clave-de-prueba-larga-123"))).toBeNull();
  });
});
