"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * 070 — Ajustes → Consultorio: profesionales, tipos de turno, obras sociales y
 * las reglas de avisos (recordatorios, encuesta, reactivación, urgencias).
 * Sin profesionales activos la agenda se comporta como siempre.
 */

type Interval = { start: string; end: string };
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type WeeklyHours = Partial<Record<DayKey, Interval[]>>;

type Professional = {
  id: string;
  name: string;
  specialty: string | null;
  active: boolean;
  weeklyHours: WeeklyHours | null;
  appointmentTypeIds: string[];
  insurances: { insuranceId: string; copay: string | null }[];
};
type AppointmentType = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number | null;
  prepNotes: string | null;
  depositAmount: number | null;
  active: boolean;
};
type Insurance = { id: string; name: string; notes: string | null; active: boolean };
type Health = {
  reminderLeadHours: number[];
  reminderTemplateId: string | null;
  waitlistEnabled: boolean;
  depositPaymentInfo: string | null;
  surveyEnabled: boolean;
  surveyDelayHours: number;
  surveyTemplateId: string | null;
  reviewUrl: string | null;
  reactivationEnabled: boolean;
  reactivationMonths: number;
  reactivationTemplateId: string | null;
  urgencyMessage: string | null;
  urgencyKeywords: string | null;
};

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Lun" },
  { key: "tue", label: "Mar" },
  { key: "wed", label: "Mié" },
  { key: "thu", label: "Jue" },
  { key: "fri", label: "Vie" },
  { key: "sat", label: "Sáb" },
  { key: "sun", label: "Dom" },
];

async function api<T>(
  url: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!res) return { ok: false, message: "Sin conexión" };
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!res.ok) return { ok: false, message: data?.error?.message ?? "No se pudo guardar" };
  return { ok: true, data: data as T };
}

const numOrNull = (v: string) => {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
};

export function SaludClient() {
  const [pros, setPros] = useState<Professional[] | null>(null);
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [ins, setIns] = useState<Insurance[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const [p, t, i, h] = await Promise.all([
      api<{ professionals: Professional[] }>("/api/salud/professionals"),
      api<{ types: AppointmentType[] }>("/api/salud/types"),
      api<{ insurances: Insurance[] }>("/api/salud/insurances"),
      api<{ settings: Health }>("/api/salud/settings"),
    ]);
    if (p.ok) setPros(p.data.professionals);
    if (t.ok) setTypes(t.data.types);
    if (i.ok) setIns(i.data.insurances);
    if (h.ok) setHealth(h.data.settings);
    if (!p.ok) setError(p.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(p: Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    const r = await p;
    if (!r.ok) setError(r.message ?? "No se pudo guardar");
    else await load();
  }

  async function saveHealth() {
    if (!health) return;
    setSaved(false);
    setError(null);
    const r = await api<{ settings: Health }>("/api/salud/settings", "PUT", health);
    if (!r.ok) return setError(r.message);
    setHealth(r.data.settings);
    setSaved(true);
  }

  if (!pros || !health) {
    return <p className="text-sm text-text-3">{error ?? "Cargando…"}</p>;
  }

  const patchHealth = (n: Partial<Health>) => {
    setHealth({ ...health, ...n });
    setSaved(false);
  };

  return (
    <div className="max-w-3xl space-y-4">
      {error && (
        <p role="alert" className="rounded-sm bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}

      <ProfessionalsCard
        pros={pros}
        types={types}
        ins={ins}
        onCreate={(b) => run(api("/api/salud/professionals", "POST", b))}
        onSave={(id, b) => run(api(`/api/salud/professionals/${id}`, "PATCH", b))}
        onDelete={(id) => run(api(`/api/salud/professionals/${id}`, "DELETE"))}
      />

      <TypesCard
        types={types}
        onCreate={(b) => run(api("/api/salud/types", "POST", b))}
        onSave={(id, b) => run(api(`/api/salud/types/${id}`, "PATCH", b))}
        onDelete={(id) => run(api(`/api/salud/types/${id}`, "DELETE"))}
      />

      <InsurancesCard
        ins={ins}
        onCreate={(b) => run(api("/api/salud/insurances", "POST", b))}
        onSave={(id, b) => run(api(`/api/salud/insurances/${id}`, "PATCH", b))}
        onDelete={(id) => run(api(`/api/salud/insurances/${id}`, "DELETE"))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Avisos a los pacientes</CardTitle>
          <CardDescription>
            Con la ventana de 24 h abierta se manda texto libre; si está cerrada, hace falta una plantilla
            aprobada por Meta (ID de plantilla). Sin ninguna de las dos, el aviso no sale.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Recordatorio 1 (horas antes)</Label>
              <Input
                type="number"
                value={health.reminderLeadHours[0] ?? ""}
                onChange={(e) => {
                  const a = numOrNull(e.target.value);
                  const b = health.reminderLeadHours[1];
                  patchHealth({ reminderLeadHours: [a, b].filter((x): x is number => x != null) });
                }}
              />
            </div>
            <div>
              <Label>Recordatorio 2 (horas antes)</Label>
              <Input
                type="number"
                value={health.reminderLeadHours[1] ?? ""}
                onChange={(e) => {
                  const a = health.reminderLeadHours[0];
                  const b = numOrNull(e.target.value);
                  patchHealth({ reminderLeadHours: [a, b].filter((x): x is number => x != null) });
                }}
              />
            </div>
          </div>
          <Field label="Plantilla de recordatorio (ID)">
            <Input
              value={health.reminderTemplateId ?? ""}
              onChange={(e) => patchHealth({ reminderTemplateId: e.target.value || null })}
            />
          </Field>
          <Field label="Cómo pagar la seña (alias, link, instrucciones)">
            <Textarea
              value={health.depositPaymentInfo ?? ""}
              onChange={(e) => patchHealth({ depositPaymentInfo: e.target.value || null })}
              rows={2}
            />
          </Field>

          <Toggle
            label="Lista de espera"
            hint="Si se cancela un turno, se le ofrece el hueco a quien esperaba."
            checked={health.waitlistEnabled}
            onChange={(v) => patchHealth({ waitlistEnabled: v })}
          />

          <Toggle
            label="Encuesta después del turno"
            checked={health.surveyEnabled}
            onChange={(v) => patchHealth({ surveyEnabled: v })}
          />
          {health.surveyEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Horas después del turno">
                <Input
                  type="number"
                  value={health.surveyDelayHours}
                  onChange={(e) => patchHealth({ surveyDelayHours: numOrNull(e.target.value) ?? 3 })}
                />
              </Field>
              <Field label="Plantilla de encuesta (ID)">
                <Input
                  value={health.surveyTemplateId ?? ""}
                  onChange={(e) => patchHealth({ surveyTemplateId: e.target.value || null })}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Link para reseña en Google (se pide con 4 o 5)">
                  <Input
                    value={health.reviewUrl ?? ""}
                    onChange={(e) => patchHealth({ reviewUrl: e.target.value || null })}
                    placeholder="https://g.page/r/…"
                  />
                </Field>
              </div>
            </div>
          )}

          <Toggle
            label="Reactivar pacientes que no vuelven"
            hint="Un solo aviso por visita, y nunca a quien pidió no recibir seguimientos."
            checked={health.reactivationEnabled}
            onChange={(v) => patchHealth({ reactivationEnabled: v })}
          />
          {health.reactivationEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Meses sin venir">
                <Input
                  type="number"
                  value={health.reactivationMonths}
                  onChange={(e) => patchHealth({ reactivationMonths: numOrNull(e.target.value) ?? 6 })}
                />
              </Field>
              <Field label="Plantilla de reactivación (ID)">
                <Input
                  value={health.reactivationTemplateId ?? ""}
                  onChange={(e) => patchHealth({ reactivationTemplateId: e.target.value || null })}
                />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Urgencias</CardTitle>
          <CardDescription>
            El agente nunca diagnostica ni da indicaciones médicas: ante una urgencia avisa al equipo y
            pasa la conversación a una persona.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Mensaje al paciente (vacío = el de siempre)">
            <Textarea
              value={health.urgencyMessage ?? ""}
              onChange={(e) => patchHealth({ urgencyMessage: e.target.value || null })}
              rows={3}
            />
          </Field>
          <Field label="Palabras propias que cuentan como prioritarias (una por línea)">
            <Textarea
              value={health.urgencyKeywords ?? ""}
              onChange={(e) => patchHealth({ urgencyKeywords: e.target.value || null })}
              rows={3}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => void saveHealth()}>Guardar avisos y urgencias</Button>
        {saved && <span className="text-sm text-success-text">Guardado</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-text-3">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={label} />
    </div>
  );
}

/* ------------------------------ profesionales ------------------------------ */

type ProBody = {
  name: string;
  specialty: string | null;
  active: boolean;
  weeklyHours: WeeklyHours | null;
  appointmentTypeIds: string[];
  insurances: { insuranceId: string; copay: string | null }[];
};

function ProfessionalsCard({
  pros,
  types,
  ins,
  onCreate,
  onSave,
  onDelete,
}: {
  pros: Professional[];
  types: AppointmentType[];
  ins: Insurance[];
  onCreate: (b: ProBody) => void;
  onSave: (id: string, b: ProBody) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profesionales</CardTitle>
        <CardDescription>
          Cada profesional tiene su propia agenda. Sin horario propio usa el de Ajustes → Agenda. Si no
          cargás ninguno, la agenda funciona como siempre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pros.map((p) => (
          <div key={p.id} className="rounded-md border p-3">
            <button
              type="button"
              onClick={() => setOpen(open === p.id ? null : p.id)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-sm font-semibold">
                {p.name}
                {p.specialty && <span className="ml-2 font-normal text-text-3">{p.specialty}</span>}
              </span>
              <Badge variant={p.active ? "success" : "secondary"}>{p.active ? "Activo" : "Inactivo"}</Badge>
            </button>
            {open === p.id && (
              <ProfessionalEditor
                pro={p}
                types={types.filter((t) => t.active)}
                ins={ins.filter((i) => i.active)}
                onSave={(b) => onSave(p.id, b)}
                onDelete={() => onDelete(p.id)}
              />
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (Dra. Pérez)" />
          <Button
            disabled={!name.trim()}
            onClick={() => {
              onCreate({
                name: name.trim(),
                specialty: null,
                active: true,
                weeklyHours: null,
                appointmentTypeIds: [],
                insurances: [],
              });
              setName("");
            }}
          >
            Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfessionalEditor({
  pro,
  types,
  ins,
  onSave,
  onDelete,
}: {
  pro: Professional;
  types: AppointmentType[];
  ins: Insurance[];
  onSave: (b: ProBody) => void;
  onDelete: () => void;
}) {
  const [d, setD] = useState<ProBody>({
    name: pro.name,
    specialty: pro.specialty,
    active: pro.active,
    weeklyHours: pro.weeklyHours,
    appointmentTypeIds: pro.appointmentTypeIds,
    insurances: pro.insurances,
  });
  const hours = d.weeklyHours ?? {};
  const toggleDay = (k: DayKey) => {
    const next = { ...hours };
    if (next[k]?.length) delete next[k];
    else next[k] = [{ start: "09:00", end: "18:00" }];
    setD({ ...d, weeklyHours: Object.keys(next).length ? next : null });
  };
  const setIv = (k: DayKey, patch: Partial<Interval>) => {
    const cur = hours[k]?.[0];
    if (!cur) return;
    setD({ ...d, weeklyHours: { ...hours, [k]: [{ ...cur, ...patch }] } });
  };
  const toggleIn = (arr: string[], id: string) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre">
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </Field>
        <Field label="Especialidad">
          <Input
            value={d.specialty ?? ""}
            onChange={(e) => setD({ ...d, specialty: e.target.value || null })}
          />
        </Field>
      </div>

      <div>
        <Label>Horario propio (vacío = el del consultorio)</Label>
        <div className="mt-1.5 space-y-1.5">
          {DAYS.map((day) => {
            const iv = hours[day.key]?.[0];
            return (
              <div key={day.key} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleDay(day.key)}
                  className={cn(
                    "w-12 rounded-sm px-2 py-1 text-left text-sm font-medium",
                    iv ? "bg-brand-tint text-brand-text" : "text-text-3 hover:bg-accent"
                  )}
                >
                  {day.label}
                </button>
                {iv && (
                  <>
                    <Input
                      type="time"
                      className="w-28"
                      value={iv.start}
                      onChange={(e) => setIv(day.key, { start: e.target.value })}
                    />
                    <span className="text-text-3">a</span>
                    <Input
                      type="time"
                      className="w-28"
                      value={iv.end}
                      onChange={(e) => setIv(day.key, { end: e.target.value })}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Tipos de turno que atiende</Label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {types.length === 0 && <span className="text-sm text-text-3">Cargá tipos de turno primero.</span>}
          {types.map((t) => (
            <Chip
              key={t.id}
              on={d.appointmentTypeIds.includes(t.id)}
              onClick={() => setD({ ...d, appointmentTypeIds: toggleIn(d.appointmentTypeIds, t.id) })}
            >
              {t.name}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <Label>Obras sociales que atiende</Label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {ins.length === 0 && <span className="text-sm text-text-3">Cargá obras sociales primero.</span>}
          {ins.map((i) => {
            const on = d.insurances.some((x) => x.insuranceId === i.id);
            return (
              <Chip
                key={i.id}
                on={on}
                onClick={() =>
                  setD({
                    ...d,
                    insurances: on
                      ? d.insurances.filter((x) => x.insuranceId !== i.id)
                      : [...d.insurances, { insuranceId: i.id, copay: null }],
                  })
                }
              >
                {i.name}
              </Chip>
            );
          })}
        </div>
      </div>

      <Toggle label="Activo" checked={d.active} onChange={(v) => setD({ ...d, active: v })} />

      <div className="flex gap-2">
        <Button onClick={() => onSave(d)}>Guardar profesional</Button>
        <Button variant="outline" onClick={onDelete}>
          Eliminar
        </Button>
      </div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        on ? "border-brand bg-brand-tint text-brand-text" : "text-text-2 hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------ tipos de turno ------------------------------ */

type TypeBody = {
  name: string;
  durationMinutes: number;
  price: number | null;
  prepNotes: string | null;
  depositAmount: number | null;
  active: boolean;
};

function TypesCard({
  types,
  onCreate,
  onSave,
  onDelete,
}: {
  types: AppointmentType[];
  onCreate: (b: TypeBody) => void;
  onSave: (id: string, b: TypeBody) => void;
  onDelete: (id: string) => void;
}) {
  const blank: TypeBody = {
    name: "",
    durationMinutes: 30,
    price: null,
    prepNotes: null,
    depositAmount: null,
    active: true,
  };
  const [draft, setDraft] = useState<TypeBody>(blank);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tipos de turno</CardTitle>
        <CardDescription>
          Cada tipo define cuánto dura, cuánto cuesta, qué hay que saber antes de venir y si pide seña.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {types.map((t) => (
          <TypeRow key={t.id} t={t} onSave={(b) => onSave(t.id, b)} onDelete={() => onDelete(t.id)} />
        ))}
        <div className="rounded-md border border-dashed p-3">
          <TypeFields d={draft} onChange={setDraft} />
          <Button
            className="mt-3"
            disabled={!draft.name.trim()}
            onClick={() => {
              onCreate({ ...draft, name: draft.name.trim() });
              setDraft(blank);
            }}
          >
            Agregar tipo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TypeFields({ d, onChange }: { d: TypeBody; onChange: (d: TypeBody) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nombre">
        <Input value={d.name} onChange={(e) => onChange({ ...d, name: e.target.value })} placeholder="Limpieza" />
      </Field>
      <Field label="Duración (minutos)">
        <Input
          type="number"
          value={d.durationMinutes}
          onChange={(e) => onChange({ ...d, durationMinutes: numOrNull(e.target.value) ?? 30 })}
        />
      </Field>
      <Field label="Precio (opcional)">
        <Input
          type="number"
          value={d.price ?? ""}
          onChange={(e) => onChange({ ...d, price: numOrNull(e.target.value) })}
        />
      </Field>
      <Field label="Seña (opcional)">
        <Input
          type="number"
          value={d.depositAmount ?? ""}
          onChange={(e) => onChange({ ...d, depositAmount: numOrNull(e.target.value) })}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Preparación (ayuno, documentación, etc.)">
          <Input
            value={d.prepNotes ?? ""}
            onChange={(e) => onChange({ ...d, prepNotes: e.target.value || null })}
          />
        </Field>
      </div>
    </div>
  );
}

function TypeRow({
  t,
  onSave,
  onDelete,
}: {
  t: AppointmentType;
  onSave: (b: TypeBody) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<TypeBody>({
    name: t.name,
    durationMinutes: t.durationMinutes,
    price: t.price,
    prepNotes: t.prepNotes,
    depositAmount: t.depositAmount,
    active: t.active,
  });
  return (
    <div className="rounded-md border p-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold">
          {t.name} <span className="font-normal text-text-3">{t.durationMinutes} min</span>
        </span>
        <span className="flex gap-1.5">
          {t.depositAmount ? <Badge variant="warning">Seña</Badge> : null}
          <Badge variant={t.active ? "success" : "secondary"}>{t.active ? "Activo" : "Inactivo"}</Badge>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <TypeFields d={d} onChange={setD} />
          <Toggle label="Activo" checked={d.active} onChange={(v) => setD({ ...d, active: v })} />
          <div className="flex gap-2">
            <Button onClick={() => onSave(d)}>Guardar</Button>
            <Button variant="outline" onClick={onDelete}>
              Eliminar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ obras sociales ------------------------------ */

type InsBody = { name: string; notes: string | null; active: boolean };

function InsurancesCard({
  ins,
  onCreate,
  onSave,
  onDelete,
}: {
  ins: Insurance[];
  onCreate: (b: InsBody) => void;
  onSave: (id: string, b: InsBody) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Obras sociales y prepagas</CardTitle>
        <CardDescription>
          Lo que cargues acá es lo único que el agente va a decir que atendés. Si no está, no lo inventa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {ins.map((i) => (
          <InsRow key={i.id} i={i} onSave={(b) => onSave(i.id, b)} onDelete={() => onDelete(i.id)} />
        ))}
        <div className="flex gap-2 pt-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="OSDE, Swiss Medical…" />
          <Button
            disabled={!name.trim()}
            onClick={() => {
              onCreate({ name: name.trim(), notes: null, active: true });
              setName("");
            }}
          >
            Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InsRow({
  i,
  onSave,
  onDelete,
}: {
  i: Insurance;
  onSave: (b: InsBody) => void;
  onDelete: () => void;
}) {
  const [notes, setNotes] = useState(i.notes ?? "");
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center">
      <span className="w-40 shrink-0 text-sm font-semibold">{i.name}</span>
      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notas (planes, coseguro, requisitos)"
      />
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={i.active}
          onCheckedChange={(v) => onSave({ name: i.name, notes: notes || null, active: v })}
          label={`${i.name} activa`}
          size="sm"
        />
        <Button size="sm" onClick={() => onSave({ name: i.name, notes: notes || null, active: i.active })}>
          Guardar
        </Button>
        <Button size="sm" variant="outline" onClick={onDelete}>
          Quitar
        </Button>
      </div>
    </div>
  );
}
