import { describe, expect, it } from "vitest";
import {
  DATA_LINK_TTL_MS,
  RETURN_TEXT,
  dataLinkUrl,
  hashToken,
  looksLikeToken,
  newToken,
  whatsappReturnUrl,
} from "@/server/salud/enlace-datos";

describe("enlace de datos (071)", () => {
  it("el token es url-safe, de 32 caracteres y distinto cada vez", () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
    expect(looksLikeToken(a)).toBe(true);
  });

  it("rechaza tokens con forma inválida", () => {
    expect(looksLikeToken("")).toBe(false);
    expect(looksLikeToken("corto")).toBe(false);
    expect(looksLikeToken("a".repeat(31) + "/")).toBe(false);
    expect(looksLikeToken("a".repeat(33))).toBe(false);
  });

  it("el hash es estable y no revela el token", () => {
    const t = newToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });

  it("arma la URL sin barras dobles", () => {
    expect(dataLinkUrl("https://crm.x.com/", "abc")).toBe("https://crm.x.com/datos/abc");
    expect(dataLinkUrl("https://crm.x.com", "abc")).toBe("https://crm.x.com/datos/abc");
  });

  it("vence a las 24 horas", () => {
    expect(DATA_LINK_TTL_MS).toBe(86_400_000);
  });

  it("el botón de volver abre el chat con el texto escrito", () => {
    const u = whatsappReturnUrl("+54 9 11 3334-6776", RETURN_TEXT);
    expect(u).toBe(`https://wa.me/5491133346776?text=${encodeURIComponent(RETURN_TEXT)}`);
    expect(whatsappReturnUrl(null, RETURN_TEXT)).toBeNull();
    expect(whatsappReturnUrl("12", RETURN_TEXT)).toBeNull();
  });
});
