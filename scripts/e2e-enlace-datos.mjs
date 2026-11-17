/**
 * Self-test E2E de comportamiento — 071 enlace de datos del paciente.
 *
 * WhatsApp prohíbe pedir el documento por el chat: el agente manda un enlace a
 * una página pública del CRM. Este guion conduce ese camino como lo viviría un
 * paciente: el bot pide el enlace, el paciente abre la página (prellenada), la
 * completa en un celular, el dato queda en su ficha, y el enlace no sirve dos
 * veces. Camino infeliz: documento inválido (no quema el enlace), enlace
 * inventado, vencido, repetido, y envíos simultáneos.
 *
 * Uso: app corriendo con AGENDA=on, WA_MOCK_ENABLED=true, BOT_API_KEY y la BD
 * migrada; luego  node --env-file=<env> scripts/e2e-enlace-datos.mjs
 * Necesita `psql` + DATABASE_URL solo para vencer un enlace a mano.
 * Sale con código 1 si algún check falla.
 */
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY;
const DB = process.env.DATABASE_URL;
const PN = "PN-ENLACE-1";
const CORRIDA = Date.now().toString(36);

let cookie = "";
let failures = 0;
function ok(name, cond, extra = "") {
  if (cond) console.log(`  OK   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  let text = null;
  try {
    text = await res.clone().text();
    json = JSON.parse(text);
  } catch {}
  return { res, status: res.status, json, text };
}
const bot = (path, opts = {}) => api(path, { ...opts, headers: { "x-api-key": BOT_KEY ?? "", ...(opts.headers ?? {}) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}
const psql = (sql) => execFileSync("psql", [DB, "-At", "-c", sql], { encoding: "utf8" }).trim();

async function paciente(from, name) {
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: { phoneNumberId: PN, from, name, text: "hola, quiero un turno", waMessageId: `wamid.enl.${CORRIDA}.${from}.${Math.random()}` },
  });
  let conv = null;
  await hasta(async () => {
    const convs = (await api("/api/conversations")).json?.conversations ?? [];
    conv = convs.find((c) => c.contact.name === name) ?? null;
    return !!conv;
  });
  return conv;
}
// Teléfonos nuevos en cada corrida: el guion se puede repetir sobre la misma base.
const tel = (n) => `54911${String(Date.now() % 1e7).padStart(7, "0")}${n}`;
const tokenDe = (url) => url.split("/datos/")[1];

async function main() {
  if (!BOT_KEY || BOT_KEY.length < 16 || !DB) {
    console.error("Faltan BOT_API_KEY (>=16) y/o DATABASE_URL.");
    process.exit(1);
  }
  console.log("== Setup ==");
  const email = "salud@vocero.test";
  let su = await api("/api/auth/sign-up/email", { method: "POST", body: { email, password: "password-e2e-123", name: "Operador Enlace" } });
  if (!su.res.ok) su = await api("/api/auth/sign-in/email", { method: "POST", body: { email, password: "password-e2e-123" } });
  ok("registro o login del operador", su.res.ok, su.text);
  const conn = await api("/api/settings/whatsapp", { method: "PUT", body: { wabaId: "WABA-ENLACE", phoneNumberId: PN, token: "tok-enlace" } });
  ok("WhatsApp conectado (wa-mock)", conn.res.ok, conn.text);

  const tipo = (await api("/api/salud/types", { method: "POST", body: { name: "Consulta", durationMinutes: 30 } })).json?.type;
  const pro = (await api("/api/salud/professionals", { method: "POST", body: { name: "Dra. Pérez", specialty: "Odontología general", appointmentTypeIds: tipo ? [tipo.id] : [] } })).json?.professional;
  ok("vertical salud activo (profesional creado)", !!pro?.id);

  const conv = await paciente(tel(1), `Paciente Enlace ${CORRIDA}`);
  ok("conversación creada", !!conv);

  console.log("\n== 1. El bot pide el enlace ==");
  const sinKey = await api("/api/bot/salud/enlace-datos", { method: "POST", body: { conversationId: conv.id } });
  ok("sin llave: 401", sinKey.status === 401, String(sinKey.status));
  const malo = await bot("/api/bot/salud/enlace-datos", { method: "POST", body: { conversationId: "cv_inventada" } });
  ok("conversación inexistente: 404", malo.status === 404, String(malo.status));
  const vacio = await bot("/api/bot/salud/enlace-datos", { method: "POST", body: {} });
  ok("sin conversationId: 422", vacio.status === 422, String(vacio.status));
  const r1 = await bot("/api/bot/salud/enlace-datos", { method: "POST", body: { conversationId: conv.id } });
  ok("crea el enlace (201)", r1.status === 201 && /\/datos\/[A-Za-z0-9_-]{32}$/.test(r1.json?.url ?? ""), r1.text);
  const url1 = r1.json.url;
  ok("la URL es absoluta al CRM", url1.startsWith(BASE), url1);
  ok("vence en ~24 h", Math.abs(new Date(r1.json.expiresAt).getTime() - (Date.now() + 86400000)) < 120000, r1.json.expiresAt);
  const enBase = psql(`select count(*) from patient_data_link where token_hash like '%${tokenDe(url1).slice(0, 6)}%'`);
  ok("el token NO se guarda en claro", enBase === "0", enBase);

  console.log("\n== 2. El paciente abre la página en el celular ==");
  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(url1);
  const cuerpo = await page.locator("body").innerText();
  ok("saluda con el nombre", cuerpo.includes("Hola, Paciente"), cuerpo.slice(0, 120));
  ok("explica por qué se pide acá", cuerpo.includes("no por WhatsApp"));
  ok("no se indexa", (await page.locator('meta[name="robots"]').getAttribute("content"))?.includes("noindex"));
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok("no desborda en 390 px", scrollW);

  console.log("\n== 3. Camino infeliz: documento inválido no quema el enlace ==");
  await page.fill('input[name="documentNumber"]', "12");
  await page.click('button[type="submit"]');
  await page.waitForSelector('form [role="alert"]', { timeout: 8000 });
  ok("muestra el error", (await page.locator('form [role="alert"]').innerText()).length > 0);
  const ficha0 = await bot(`/api/bot/salud/paciente?conversationId=${conv.id}`);
  ok("nada se guardó", !ficha0.json?.patient?.documentNumber, JSON.stringify(ficha0.json));

  console.log("\n== 4. Camino feliz: completa y queda en la ficha ==");
  await page.fill('input[name="documentNumber"]', "30.123.456");
  await page.fill('input[name="birthDate"]', "1990-05-17");
  await page.fill('input[name="affiliateNumber"]', "A-99");
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="datos-listo"]', { timeout: 8000 });
  ok("pantalla de listo", true);
  const wa = await page.locator('[data-testid="datos-listo"] a').getAttribute("href").catch(() => null);
  ok("botón «Volver a WhatsApp» con el mensaje ya escrito", !!wa && wa.startsWith("https://wa.me/") && wa.includes(encodeURIComponent("Listo, ya completé mis datos")), String(wa));
  const ficha1 = await bot(`/api/bot/salud/paciente?conversationId=${conv.id}`);
  const p = ficha1.json?.patient;
  ok("documento en la ficha (normalizado)", p?.documentNumber === "30123456", JSON.stringify(p));
  ok("nacimiento y afiliado en la ficha", p?.birthDate === "1990-05-17" && p?.affiliateNumber === "A-99", JSON.stringify(p));
  const ctxBot = await bot(`/api/bot/context?conversationId=${conv.id}`);
  ok("el contexto del bot ya ve el documento (Nea sigue con la reserva)", ctxBot.json?.salud?.patient?.documentNumber === "30123456", JSON.stringify(ctxBot.json?.salud?.patient));
  const panel = await api(`/api/salud/patients/${conv.contact.id}`);
  ok("y el panel del CRM lo muestra en la ficha", panel.status === 200 && JSON.stringify(panel.json).includes("30123456"), panel.text?.slice(0, 160));

  console.log("\n== 5. El enlace no sirve dos veces ==");
  await page.goto(url1);
  ok("recargar muestra «ya completaste»", (await page.locator("body").innerText()).includes("Ya completaste"));
  const reuso = await api(`/api/datos/${tokenDe(url1)}`, { method: "POST", body: { documentNumber: "99999999" } });
  ok("reenviar: 409", reuso.status === 409, String(reuso.status));
  const ficha2 = await bot(`/api/bot/salud/paciente?conversationId=${conv.id}`);
  ok("la ficha no se pisó", ficha2.json?.patient?.documentNumber === "30123456");

  console.log("\n== 6. Enlace inventado y vencido ==");
  const inv = await api(`/api/datos/${"x".repeat(32)}`, { method: "POST", body: { documentNumber: "30123456" } });
  ok("inventado: 404", inv.status === 404, String(inv.status));
  const basura = await api(`/api/datos/corto`, { method: "POST", body: { documentNumber: "30123456" } });
  ok("con forma inválida: 404", basura.status === 404, String(basura.status));
  await page.goto(`${BASE}/datos/${"y".repeat(32)}`);
  ok("página de inventado: «no es válido»", (await page.locator("body").innerText()).includes("no es válido"));
  const conv2 = await paciente(tel(2), `Paciente Vence ${CORRIDA}`);
  const r2 = await bot("/api/bot/salud/enlace-datos", { method: "POST", body: { conversationId: conv2.id } });
  psql(`update patient_data_link set expires_at = now() - interval '1 minute' where conversation_id = '${conv2.id}'`);
  await page.goto(r2.json.url);
  ok("vencido: «venció»", (await page.locator("body").innerText()).includes("venció"));
  const venc = await api(`/api/datos/${tokenDe(r2.json.url)}`, { method: "POST", body: { documentNumber: "30123456" } });
  ok("enviar con enlace vencido: 409", venc.status === 409, String(venc.status));

  console.log("\n== 7. Dos envíos a la vez: gana uno solo ==");
  const conv3 = await paciente(tel(3), `Paciente Carrera ${CORRIDA}`);
  const r3 = await bot("/api/bot/salud/enlace-datos", { method: "POST", body: { conversationId: conv3.id } });
  const tok3 = tokenDe(r3.json.url);
  const carrera = await Promise.all(
    ["31111111", "32222222", "33333333", "34444444"].map((d) =>
      api(`/api/datos/${tok3}`, { method: "POST", body: { documentNumber: d } })
    )
  );
  const ganadores = carrera.filter((c) => c.status === 200).length;
  ok("exactamente un envío gana", ganadores === 1, carrera.map((c) => c.status).join(","));

  await browser.close();
  console.log(failures === 0 ? "\nTODO VERDE" : `\n${failures} check(s) fallaron`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
