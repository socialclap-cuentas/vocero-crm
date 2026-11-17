"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEvents } from "@/components/use-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/**
 * 070 — Ficha ADMINISTRATIVA del paciente en el panel del contacto: documento,
 * nacimiento, obra social y afiliado. Nada clínico (síntomas, diagnósticos,
 * historia): el CRM no es una historia clínica. Si el consultorio no está
 * activo, el API responde que no y el panel no se pinta.
 */

type Patient = {
  documentNumber: string | null;
  birthDate: string | null;
  insuranceId: string | null;
  affiliateNumber: string | null;
  optOutFollowups: boolean;
};
type Insurance = { id: string; name: string; active: boolean };

export function PatientPanel({ contactId }: { contactId: string }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [ins, setIns] = useState<Insurance[]>([]);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Si la persona está editando, un refresco en vivo no le pisa lo que escribe.
  const dirty = useRef(false);

  const load = useCallback(
    async (alive: () => boolean) => {
      const [p, i] = await Promise.all([
        fetch(`/api/salud/patients/${contactId}`).catch(() => null),
        fetch("/api/salud/insurances").catch(() => null),
      ]);
      if (!alive()) return;
      if (!p?.ok) return setHidden(true);
      setPatient(((await p.json()) as { patient: Patient }).patient);
      if (i?.ok) setIns(((await i.json()) as { insurances: Insurance[] }).insurances);
    },
    [contactId]
  );

  useEffect(() => {
    let alive = true;
    dirty.current = false;
    setPatient(null);
    setHidden(false);
    setMsg(null);
    void load(() => alive);
    return () => {
      alive = false;
    };
  }, [load]);

  // El agente guarda el documento y la obra social mientras la ficha está
  // abierta: se refresca con cada mensaje o cita nueva, sin recargar la página.
  const refresh = useCallback(() => {
    if (!dirty.current) void load(() => true);
  }, [load]);
  useEvents({
    onMessageNew: refresh,
    onBookingUpdated: refresh,
    onConversationUpdated: refresh,
    onReconnect: refresh,
  });

  if (hidden || !patient) return null;

  const set = (n: Partial<Patient>) => {
    dirty.current = true;
    setPatient({ ...patient, ...n });
    setMsg(null);
  };

  async function save() {
    if (!patient) return;
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/salud/patients/${contactId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentNumber: patient.documentNumber,
        birthDate: patient.birthDate,
        insuranceId: patient.insuranceId,
        affiliateNumber: patient.affiliateNumber,
        optOutFollowups: patient.optOutFollowups,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setMsg(data?.error?.message ?? "No se pudo guardar");
    }
    dirty.current = false;
    setPatient(((await res.json()) as { patient: Patient }).patient);
    setMsg("Guardado");
  }

  return (
    <section className="space-y-2 border-b p-4">
      <p className="kicker">Paciente</p>
      <Input
        value={patient.documentNumber ?? ""}
        onChange={(e) => set({ documentNumber: e.target.value || null })}
        placeholder="DNI"
        aria-label="Documento"
      />
      <Input
        type="date"
        value={patient.birthDate ?? ""}
        onChange={(e) => set({ birthDate: e.target.value || null })}
        aria-label="Fecha de nacimiento"
      />
      <select
        value={patient.insuranceId ?? ""}
        onChange={(e) => set({ insuranceId: e.target.value || null })}
        aria-label="Obra social"
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Particular / sin obra social</option>
        {ins
          .filter((i) => i.active || i.id === patient.insuranceId)
          .map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
      </select>
      {patient.insuranceId && (
        <Input
          value={patient.affiliateNumber ?? ""}
          onChange={(e) => set({ affiliateNumber: e.target.value || null })}
          placeholder="N.º de afiliado"
          aria-label="Número de afiliado"
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-2">No enviarle seguimientos</span>
        <Switch
          size="sm"
          checked={patient.optOutFollowups}
          onCheckedChange={(v) => set({ optOutFollowups: v })}
          label="No enviarle seguimientos"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          Guardar
        </Button>
        {msg && <span className="text-xs text-text-3">{msg}</span>}
      </div>
    </section>
  );
}
