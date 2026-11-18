import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEMO_PHONE_PREFIX, esConversacionDeDemo } from "@/server/demo/chat";

describe("sala de chat de la demo", () => {
  it("reconoce solo los teléfonos de la demo", () => {
    expect(esConversacionDeDemo(`${DEMO_PHONE_PREFIX}123456`)).toBe(true);
    expect(esConversacionDeDemo("5491155551234")).toBe(false);
    expect(esConversacionDeDemo(null)).toBe(false);
  });

  it("el cliente y el servidor usan el mismo prefijo", () => {
    const cliente = readFileSync("src/components/inbox/demo-paciente.tsx", "utf8");
    expect(cliente).toContain(`PREFIJO_DEMO = "${DEMO_PHONE_PREFIX}"`);
  });

  it("las rutas se niegan con la bandera apagada", () => {
    for (const f of [
      "src/app/api/demo/chat/route.ts",
      "src/app/api/demo/chat/[id]/route.ts",
    ]) {
      expect(readFileSync(f, "utf8")).toContain("if (!demoMode())");
    }
  });
});
