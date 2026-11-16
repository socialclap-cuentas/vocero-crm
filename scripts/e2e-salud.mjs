/**
 * Self-test E2E de comportamiento — 070 vertical salud.
 *
 * Conduce la app real (con la agenda encendida y los mocks de WhatsApp) por sus
 * superficies HTTP: catálogo del consultorio, disponibilidad por profesional y
 * tipo de turno, reserva con seña, la carrera del mismo hueco, confirmación,
 * ficha del paciente, urgencias, cancelación → lista de espera, recordatorios y
 * encuesta (con el barrido de fondo corriendo de verdad) y las métricas. También
 * el camino infeliz: ids inventados, fechas imposibles, un hueco ya ocupado.
 *
 * Uso: app corriendo con AGENDA=on, WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL →
 * wa-mock y BOT_API_KEY; luego
 *   node --env-file=<env> scripts/e2e-salud.mjs
 * Necesita `psql` y DATABASE_URL: solo para ENVEJECER citas (el barrido actúa
 * por reloj y no se espera a que pase el tiempo de verdad).
 * Sale con código 1 si algún check falla.
 */
import { execFileSync } from "node:child_process";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY;
const DB = process.env.DATABASE_URL;
const PN = "PN-SALUD-1";
const TZ = "America/Argentina/Buenos_Aires";
const CORRIDA = Date.now().toString(36);

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
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
const bot = (path, opts = {}) =>
  api(path, { ...opts, headers: { "x-api-key": BOT_KEY ?? "", ...(opts.headers ?? {}) } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}
function psql(sql) {
  return execFileSync("psql", [DB, "-At", "-c", sql], { encoding: "utf8" }).trim();
}
const outbox = async () => (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
const para = (o, num) => String(o.to ?? o.recipient ?? "").endsWith(num.slice(-8));
const textoDe = (o) => o.body?.text?.body ?? o.body?.template?.name ?? "";

/** Un paciente nuevo: entra un mensaje y devuelve su conversación y contacto. */
async function paciente(from, name, text = "hola, quiero sacar un turno") {
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: { phoneNumberId: PN, from, name, text, waMessageId: `wamid.salud.${CORRIDA}.${from}.${Math.random()}` },
  });
  let conv = null;
  await hasta(async () => {
    const convs = (await api("/api/conversations")).json?.conversations ?? [];
    conv = convs.find((c) => c.contact.name === name) ?? null;
    return !!conv;
  });
  return conv;
}

async function huecos(conversationId, extra = "") {
  const r = await bot(`/api/bot/availability?conversationId=${conversationId}&limit=12${extra}`);
  return { ...r, slots: r.json?.slots ?? [] };
}

async function main() {
  if (!BOT_KEY || BOT_KEY.length < 16 || !DB) {
    console.error("Faltan BOT_API_KEY (>=16) y/o DATABASE_URL.");
    process.exit(1);
  }

  console.log("== Setup ==");
  const email = "salud@vocero.test";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: { email, password: "password-e2e-123", name: "Operador Salud" },
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: "salud@vocero.test", password: "password-e2e-123" },
    });
  }
  ok("registro o login del operador", su.res.ok, su.text);
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: { wabaId: "WABA-SALUD", phoneNumberId: PN, token: "tok-salud" },
  });
  ok("WhatsApp conectado (wa-mock)", conn.res.ok, conn.text);

  const cfg = await api("/api/calendar/settings", {
    method: "PUT",
    body: {
      timezone: TZ,
      weeklyHours: Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "09:00", end: "18:00" }]])
      ),
      slotMinutes: 30,
      minNoticeHours: 0,
      maxDaysAhead: 14,
      connector: "enlace-fijo",
      meetingLink: "https://meet.ejemplo.test/consultorio",
    },
  });
  ok("horario del consultorio guardado", cfg.status < 400, cfg.text);

  console.log("\n== 1. Sin profesionales, la agenda es la de siempre ==");
  const conv0 = await paciente("5491100000001", "Paciente Cero");
  ok("conversación creada", !!conv0);
  const ctx0 = await bot(`/api/bot/context?conversationId=${conv0.id}`);
  ok("el contexto NO trae `salud` sin profesionales", ctx0.json && !("salud" in ctx0.json), JSON.stringify(Object.keys(ctx0.json ?? {})));
  const h0 = await huecos(conv0.id);
  ok("hay huecos de la agenda de siempre", h0.slots.length > 0);
  ok("y salen con las llaves de siempre (sin profesional)", h0.slots.every((s) => !("professionalId" in s)), JSON.stringify(h0.slots[0]));

  console.log("\n== 2. Catálogo del consultorio ==");
  const osde = (await api("/api/salud/insurances", { method: "POST", body: { name: "OSDE", notes: "plan 210 y 310" } })).json?.insurance;
  const swiss = (await api("/api/salud/insurances", { method: "POST", body: { name: "Swiss Medical" } })).json?.insurance;
  ok("obras sociales creadas", !!osde?.id && !!swiss?.id);
  const limpieza = (
    await api("/api/salud/types", {
      method: "POST",
      body: { name: "Limpieza", durationMinutes: 60, price: 30000, depositAmount: 5000, prepNotes: "Traé tu DNI y carnet" },
    })
  ).json?.type;
  const consulta = (await api("/api/salud/types", { method: "POST", body: { name: "Consulta", durationMinutes: 30 } })).json?.type;
  ok("tipos de turno creados", !!limpieza?.id && !!consulta?.id);
  const perez = (
    await api("/api/salud/professionals", {
      method: "POST",
      body: {
        name: "Dra. Pérez",
        specialty: "Odontología general",
        appointmentTypeIds: [limpieza.id, consulta.id],
        insurances: [{ insuranceId: osde.id, copay: "sin coseguro" }],
      },
    })
  ).json?.professional;
  const gomez = (
    await api("/api/salud/professionals", {
      method: "POST",
      body: {
        name: "Dr. Gómez",
        specialty: "Ortodoncia",
        appointmentTypeIds: [consulta.id],
        insurances: [{ insuranceId: swiss.id }],
        weeklyHours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "09:00", end: "12:00" }]])),
      },
    })
  ).json?.professional;
  ok("profesionales creados", !!perez?.id && !!gomez?.id);
  const bad = await api("/api/salud/types", { method: "POST", body: { name: "", durationMinutes: 1 } });
  ok("tipo inválido → 422 (camino infeliz)", bad.status === 422, `status=${bad.status}`);
  const st = await api("/api/salud/settings", {
    method: "PUT",
    body: {
      depositPaymentInfo: "Transferí a alias clinica.sonrisa",
      reviewUrl: "https://g.page/r/clinica-sonrisa",
      reminderLeadHours: [48, 2],
      surveyDelayHours: 3,
      surveyEnabled: true,
      waitlistEnabled: true,
    },
  });
  ok("ajustes de avisos guardados", st.status === 200, st.text);

  const cat = await bot("/api/bot/salud/catalog");
  ok("catálogo para el agente (200)", cat.status === 200, cat.text);
  ok("trae 2 profesionales, 2 tipos y 2 obras sociales", cat.json?.professionals?.length === 2 && cat.json?.appointmentTypes?.length === 2 && cat.json?.insurances?.length === 2);
  ok("la Dra. Pérez atiende OSDE y no Swiss", JSON.stringify(cat.json?.professionals?.find((p) => p.name === "Dra. Pérez")?.insurances).includes("OSDE") && !JSON.stringify(cat.json?.professionals?.find((p) => p.name === "Dra. Pérez")?.insurances).includes("Swiss"));
  ok("trae cómo pagar la seña y el link de reseña", cat.json?.rules?.depositPaymentInfo?.includes("clinica.sonrisa") && cat.json?.rules?.reviewUrl?.includes("g.page"));
  ok("la API de bot exige llave (401 sin ella)", (await api("/api/bot/salud/catalog")).status === 401);

  console.log("\n== 3. Disponibilidad por profesional, tipo y obra social ==");
  const convA = await paciente("5491100000011", "Ana Paciente");
  const ctxA = await bot(`/api/bot/context?conversationId=${convA.id}`);
  ok("ahora el contexto SÍ trae `salud`", !!ctxA.json?.salud && ctxA.json.salud.nextBooking === null);
  const hLimp = await huecos(convA.id, `&appointmentTypeId=${limpieza.id}`);
  ok("Limpieza: hay huecos y todos son de la Dra. Pérez (el Dr. Gómez no la hace)", hLimp.slots.length > 0 && hLimp.slots.every((s) => s.professionalId === perez.id), JSON.stringify(hLimp.slots.slice(0, 2)));
  const h2 = (a, b) => (new Date(b.startUtc) - new Date(a.startUtc));
  ok("los huecos de una hora no se pisan entre sí", hLimp.slots.slice(1).every((s, i) => h2(hLimp.slots[i], s) >= 3600_000 || new Date(s.startUtc).toDateString() !== new Date(hLimp.slots[i].startUtc).toDateString()));
  const hSwiss = await huecos(convA.id, `&appointmentTypeId=${consulta.id}&insuranceId=${swiss.id}`);
  ok("Consulta con Swiss Medical: solo el Dr. Gómez", hSwiss.slots.length > 0 && hSwiss.slots.every((s) => s.professionalId === gomez.id));
  const hFalso = await huecos(convA.id, `&professionalId=pro_inexistente`);
  ok("profesional inventado → 404/422, no un 500", [404, 422].includes(hFalso.status), `status=${hFalso.status}`);
  const hTipoFalso = await huecos(convA.id, `&appointmentTypeId=apt_inexistente`);
  ok("tipo de turno inventado → 404/422", [404, 422].includes(hTipoFalso.status), `status=${hTipoFalso.status}`);
  // Volver a ofrecer para dejar la oferta de Ana en Limpieza.
  const oferta = await huecos(convA.id, `&appointmentTypeId=${limpieza.id}`);
  const slot = oferta.slots[0];

  console.log("\n== 4. Reserva, seña y la carrera por el mismo hueco ==");
  const convB = await paciente("5491100000012", "Beto Paciente");
  const ofertaB = await huecos(convB.id, `&appointmentTypeId=${limpieza.id}`);
  ok("Beto ve el MISMO primer hueco que Ana", ofertaB.slots[0]?.startUtc === slot.startUtc);
  const noOfrecido = await bot("/api/bot/bookings", { method: "POST", body: { conversationId: convA.id, startUtc: "2030-01-01T12:00:00.000Z" } });
  ok("reservar un horario NO ofrecido se rechaza (409)", noOfrecido.status === 409, `status=${noOfrecido.status} ${noOfrecido.text}`);
  const resA = await bot("/api/bot/bookings", {
    method: "POST",
    body: { conversationId: convA.id, startUtc: slot.startUtc, insuranceId: osde.id },
  });
  ok("Ana reserva (201)", resA.status === 201, resA.text);
  ok("la respuesta trae la seña pendiente", resA.json?.depositAmount === 5000 && resA.json?.depositStatus === "pendiente", resA.text);
  const resB = await bot("/api/bot/bookings", { method: "POST", body: { conversationId: convB.id, startUtc: slot.startUtc } });
  ok("Beto, mismo hueco → 409 slot_taken CON alternativas", resB.status === 409 && resB.json?.error?.code === "slot_taken" && (resB.json?.slots?.length ?? 0) > 0, resB.text);
  const filas = psql(`select count(*) from booking where scheduled_at='${slot.startUtc.replace("Z", "")}' and status='agendada' and kind='session'`);
  ok("en la base quedó UNA sola cita para ese hueco", filas === "1", `filas=${filas}`);

  const lista = (await api("/api/bookings")).json?.bookings ?? [];
  const bA = lista.find((b) => b.id === resA.json?.bookingId);
  ok("el panel muestra profesional, tipo, seña pendiente y sin confirmar", bA?.professional?.name === "Dra. Pérez" && bA?.appointmentType?.name === "Limpieza" && bA?.depositStatus === "pendiente" && bA?.confirmation === "pendiente", JSON.stringify(bA));
  ok("y dura lo que dura el tipo (60 min)", bA?.durationMinutes === 60);

  console.log("\n== 5. Ficha administrativa del paciente ==");
  const malFecha = await bot("/api/bot/salud/paciente", { method: "PUT", body: { conversationId: convA.id, birthDate: "1990-02-31" } });
  ok("fecha de nacimiento imposible → 422", malFecha.status === 422, `status=${malFecha.status}`);
  const futura = await bot("/api/bot/salud/paciente", { method: "PUT", body: { conversationId: convA.id, birthDate: "2999-01-01" } });
  ok("fecha de nacimiento futura → 422", futura.status === 422);
  const malDoc = await bot("/api/bot/salud/paciente", { method: "PUT", body: { conversationId: convA.id, documentNumber: "12" } });
  ok("documento demasiado corto → 422", malDoc.status === 422);
  const guarda = await bot("/api/bot/salud/paciente", {
    method: "PUT",
    body: { conversationId: convA.id, documentNumber: "30.123.456", birthDate: "1990-05-17", insuranceId: osde.id, affiliateNumber: "A-99" },
  });
  ok("datos válidos se guardan (documento normalizado)", guarda.status === 200 && guarda.json?.patient?.documentNumber === "30123456", guarda.text);
  const insFalsa = await bot("/api/bot/salud/paciente", { method: "PUT", body: { conversationId: convA.id, insuranceId: "ins_inventada" } });
  ok("obra social inventada → 404/422", [404, 422].includes(insFalsa.status), `status=${insFalsa.status}`);
  const panelPac = await api(`/api/salud/patients/${convA.contact.id}`);
  ok("el panel lee la misma ficha", panelPac.json?.patient?.documentNumber === "30123456" && panelPac.json?.patient?.affiliateNumber === "A-99");

  console.log("\n== 6. Confirmación y seña ==");
  const ctxA2 = await bot(`/api/bot/context?conversationId=${convA.id}`);
  ok("el contexto trae el próximo turno con su profesional, tipo y seña", ctxA2.json?.salud?.nextBooking?.professional?.name === "Dra. Pérez" && ctxA2.json?.salud?.nextBooking?.depositStatus === "pendiente", JSON.stringify(ctxA2.json?.salud?.nextBooking));
  const conf = await bot("/api/bot/salud/turno/confirmar", { method: "POST", body: { conversationId: convA.id } });
  ok("el paciente confirma (200)", conf.status === 200 && conf.json?.ok === true, conf.text);
  const sinTurno = await bot("/api/bot/salud/turno/confirmar", { method: "POST", body: { conversationId: convB.id } });
  ok("confirmar sin turno → 404 (no inventa nada)", sinTurno.status === 404, `status=${sinTurno.status}`);
  const pago = await api(`/api/bookings/${resA.json.bookingId}`, { method: "PATCH", body: { action: "deposit", depositStatus: "pagada" } });
  ok("el consultorio marca la seña como pagada", pago.status === 200, pago.text);
  const bA2 = ((await api("/api/bookings")).json?.bookings ?? []).find((b) => b.id === resA.json.bookingId);
  ok("el panel refleja: confirmó + seña pagada", bA2?.confirmation === "confirmada" && bA2?.depositStatus === "pagada", JSON.stringify(bA2));

  console.log("\n== 7. Urgencias (red determinista, sin agente) ==");
  const convU = await paciente("5491100000021", "Ursula Urgente", "hola");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: { phoneNumberId: PN, from: "5491100000021", name: "Ursula Urgente", text: "Me duele mucho el pecho y no puedo respirar", waMessageId: `wamid.salud.urg.${CORRIDA}` },
  });
  let tri = [];
  const llego = await hasta(async () => {
    tri = (await api("/api/salud/triage")).json?.triage ?? [];
    return tri.some((t) => t.contactName === "Ursula Urgente");
  }, 8000);
  ok("el mensaje urgente queda registrado sin que intervenga el agente", llego, JSON.stringify(tri));
  const tU = tri.find((t) => t.contactName === "Ursula Urgente");
  ok("nivel urgente, con el motivo", tU?.level === "urgente" && /pecho|respirar/.test(tU?.reason ?? ""), JSON.stringify(tU));
  const convsU = (await api("/api/conversations")).json?.conversations ?? [];
  const cU = convsU.find((c) => c.id === convU.id);
  ok("la IA queda pausada en esa conversación", cU?.aiEnabled === false, JSON.stringify({ aiEnabled: cU?.aiEnabled }));
  await paciente("5491100000022", "Nora Normal", "hola, ¿atienden OSDE? quiero una limpieza");
  await sleep(1200);
  const triN = (await api("/api/salud/triage")).json?.triage ?? [];
  ok("un mensaje normal NO dispara urgencia (sin falsos avisos)", !triN.some((t) => t.contactName === "Nora Normal"));
  const urgBot = await bot("/api/bot/salud/urgencia", { method: "POST", body: { conversationId: convB.id, level: "prioritario", reason: "dolor muy fuerte en la muela" } });
  ok("el agente puede registrar una urgencia prioritaria y recibe el mensaje a decir", urgBot.status === 200 && urgBot.json?.level === "prioritario" && !!urgBot.json?.message, urgBot.text);
  const convsB = (await api("/api/conversations")).json?.conversations ?? [];
  ok("prioritaria NO pausa la IA", convsB.find((c) => c.id === convB.id)?.aiEnabled !== false);
  const res1 = await api(`/api/salud/triage/${tU?.id}`, { method: "DELETE" });
  ok("se marca como atendida", res1.status === 200);
  const res2 = await api(`/api/salud/triage/${tU?.id}`, { method: "DELETE" });
  ok("marcar dos veces → 200 (idempotente, sin romper)", res2.status === 200, `status=${res2.status}`);
  const res3 = await api("/api/salud/triage/trg_inexistente", { method: "DELETE" });
  ok("urgencia inexistente → 404", res3.status === 404, `status=${res3.status}`);

  console.log("\n== 8. Cancelación → lista de espera → hueco ofrecido ==");
  const esp = await bot("/api/bot/salud/espera", { method: "POST", body: { conversationId: convB.id, professionalId: perez.id, appointmentTypeId: limpieza.id, preferences: "mañanas" } });
  ok("Beto se anota en la lista de espera (201)", esp.status === 201, esp.text);
  const ctxB = await bot(`/api/bot/context?conversationId=${convB.id}`);
  ok("el contexto de Beto dice que espera", ctxB.json?.salud?.waitlist?.status === "waiting");
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const cancSin = await bot("/api/bot/salud/turno/cancelar", { method: "POST", body: { conversationId: convA.id, confirmed: false } });
  ok("cancelar SIN confirmed:true se rechaza (422)", cancSin.status === 422, `status=${cancSin.status} ${cancSin.text}`);
  const canc = await bot("/api/bot/salud/turno/cancelar", { method: "POST", body: { conversationId: convA.id, confirmed: true } });
  ok("Ana cancela su turno (200)", canc.status === 200, canc.text);
  const ofrecido = await hasta(async () => {
    const w = (await api("/api/salud/waitlist")).json?.waitlist ?? [];
    return w.some((e) => e.contactName === "Beto Paciente" && e.status === "offered");
  }, 10000);
  ok("el hueco liberado se le OFRECE a Beto automáticamente", ofrecido);
  const out = await outbox();
  const aviso = out.find((o) => para(o, "5491100000012") && /hueco|lugar|turno|liber/i.test(textoDe(o)));
  ok("y le llega el aviso por WhatsApp", !!aviso, JSON.stringify(out.map((o) => [o.to, textoDe(o).slice(0, 60)])));
  const ctxB2 = await bot(`/api/bot/context?conversationId=${convB.id}`);
  const of = ctxB2.json?.salud?.waitlist?.offered;
  ok("el contexto trae el hueco ofrecido completo (para que el agente lo reserve)", !!of?.startUtc && of?.professionalId === perez.id, JSON.stringify(ctxB2.json?.salud?.waitlist));
  const tomar = await bot("/api/bot/bookings", { method: "POST", body: { conversationId: convB.id, startUtc: of?.startUtc } });
  ok("Beto acepta y reserva el hueco ofrecido (201)", tomar.status === 201, tomar.text);
  const w2 = (await api("/api/salud/waitlist")).json?.waitlist ?? [];
  ok("la lista de espera lo da de baja al reservar", !w2.some((e) => e.contactName === "Beto Paciente"));
  const cancOtraVez = await bot("/api/bot/salud/turno/cancelar", { method: "POST", body: { conversationId: convA.id, confirmed: true } });
  ok("cancelar de nuevo sin turno activo → 404", cancOtraVez.status === 404, `status=${cancOtraVez.status}`);

  console.log("\n== 9. Recordatorio y encuesta (el barrido corre de verdad) ==");
  // Cita para dentro de ~1 día; se la 'vieja' creación hace que el aviso de 48 h corresponda.
  const convR = await paciente("5491100000031", "Rita Recordatorio");
  const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const hR = await huecos(convR.id, `&appointmentTypeId=${consulta.id}&date=${manana}`);
  const slotR = hR.slots[0];
  const bR = await bot("/api/bot/bookings", { method: "POST", body: { conversationId: convR.id, startUtc: slotR.startUtc } });
  ok("Rita reserva para mañana", bR.status === 201, bR.text);
  psql(`update booking set created_at = now() - interval '5 days' where id='${bR.json.bookingId}'`);

  const convS = await paciente("5491100000032", "Sofía Encuesta");
  const hS = await huecos(convS.id, `&appointmentTypeId=${consulta.id}&date=${manana}`);
  const slotS = hS.slots.find((s) => s.startUtc !== slotR.startUtc) ?? hS.slots[1];
  const bS = await bot("/api/bot/bookings", { method: "POST", body: { conversationId: convS.id, startUtc: slotS.startUtc } });
  ok("Sofía reserva", bS.status === 201, bS.text);
  psql(`update booking set scheduled_at = now() - interval '5 hours', created_at = now() - interval '6 days' where id='${bS.json.bookingId}'`);
  const encPrev = await bot("/api/bot/salud/encuesta", { method: "POST", body: { conversationId: convS.id, score: 5 } });
  ok("responder una encuesta que nunca se envió → 404/409 (no inventa)", [404, 409].includes(encPrev.status), `status=${encPrev.status}`);

  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  console.log("  … esperando el barrido de fondo (corre cada minuto, hasta ~2 min)");
  const sentR = () => psql(`select reminder_first_at is not null or reminder_second_at is not null from booking where id='${bR.json.bookingId}'`) === "t";
  const sentS = () => psql(`select survey_sent_at is not null from booking where id='${bS.json.bookingId}'`) === "t";
  const hechoR = await hasta(sentR, 130000, 3000);
  const hechoS = await hasta(sentS, 130000, 3000);
  ok("el recordatorio se envió y quedó marcado en la base", hechoR);
  ok("la encuesta se envió y quedó marcada en la base", hechoS);
  const out2 = await outbox();
  const toR = out2.filter((o) => para(o, "5491100000031"));
  const toS = out2.filter((o) => para(o, "5491100000032"));
  ok("a Rita le llegó UN recordatorio con su turno", toR.length === 1 && /recordamos|turno|Recordatorio/i.test(textoDe(toR[0] ?? {})), JSON.stringify(toR.map(textoDe)));
  ok("a Sofía le llegó UNA encuesta", toS.length === 1 && /1|5|c[oó]mo te fue/i.test(textoDe(toS[0] ?? {})), JSON.stringify(toS.map(textoDe)));
  const encOk = await bot("/api/bot/salud/encuesta", { method: "POST", body: { conversationId: convS.id, score: 5, comment: "excelente" } });
  ok("Sofía responde 5 → guarda y devuelve el link de reseña", encOk.status === 200 && encOk.json?.reviewUrl?.includes("g.page"), encOk.text);
  const encMala = await bot("/api/bot/salud/encuesta", { method: "POST", body: { conversationId: convS.id, score: 9 } });
  ok("un puntaje fuera de 1–5 → 422", encMala.status === 422, `status=${encMala.status}`);
  const confR = await bot("/api/bot/salud/turno/confirmar", { method: "POST", body: { conversationId: convR.id } });
  ok("Rita responde «confirmo» → confirma su turno", confR.status === 200);

  console.log("\n== 10. Un barrido más NO duplica mensajes (idempotencia) ==");
  const antes = (await outbox()).filter((o) => /5491100000031|5491100000032/.test(`${o.to}${o.recipient ?? ""}`)).length;
  await sleep(75000);
  const despues = (await outbox()).filter((o) => /5491100000031|5491100000032/.test(`${o.to}${o.recipient ?? ""}`)).length;
  ok("tras otro barrido no se reenvió nada", despues === antes, `antes=${antes} después=${despues}`);

  console.log("\n== 11. Métricas ==");
  const metRes = await api("/api/salud/metrics");
  const met = { ...metRes, json: metRes.json?.metrics ?? null };
  ok("las métricas responden y cuentan los turnos", met.status === 200 && met.json?.totals?.total >= 3, metRes.text);
  ok("cuentan la cancelación de la paciente", met.json?.totals?.canceladasPorPaciente >= 1, JSON.stringify(met.json?.totals));
  ok("y la encuesta (promedio 5)", met.json?.survey?.responses >= 1 && met.json?.survey?.average === 5, JSON.stringify(met.json?.survey));
  ok("hay un renglón por profesional", (met.json?.perProfessional ?? []).some((p) => p.name === "Dra. Pérez"));
  const metMal = await api("/api/salud/metrics?from=2026-13-40&to=2026-01-01");
  ok("rango inválido → 422", metMal.status === 422, `status=${metMal.status}`);

  console.log("\n== 12. Pantallas ==");
  for (const [ruta, marca] of [["/settings/salud", ""], ["/consultorio", ""], ["/bookings", ""]]) {
    const r = await api(ruta);
    ok(`${ruta} responde 200`, r.status === 200, `status=${r.status}`);
  }
  const nav = await api("/consultorio");
  ok("la pantalla del consultorio no es un 404 de Next", !/<title>[^<]*could not be found/i.test(nav.text ?? ""));

  console.log(`\n${checks - failures}/${checks} checks OK${failures ? `, ${failures} FALLARON` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
