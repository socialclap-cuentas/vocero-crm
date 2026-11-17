"use client";

import { useState } from "react";

type Estado = "form" | "enviando" | "listo";

export function DatosForm({
  token,
  whatsappUrl,
}: {
  token: string;
  whatsappUrl: string | null;
}) {
  const [estado, setEstado] = useState<Estado>("form");
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setEstado("enviando");
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/datos/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentNumber: String(f.get("documentNumber") ?? ""),
          birthDate: String(f.get("birthDate") ?? "") || null,
          affiliateNumber: String(f.get("affiliateNumber") ?? "") || null,
        }),
      });
      if (res.ok) {
        setEstado("listo");
        return;
      }
      const j = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(j?.error?.message ?? "No pudimos guardar tus datos. Probá de nuevo.");
    } catch {
      setError("No hay conexión. Probá de nuevo en un momento.");
    }
    setEstado("form");
  }

  if (estado === "listo") {
    return (
      <div className="mt-8 rounded-2xl bg-green-50 p-5" data-testid="datos-listo">
        <p className="text-lg font-bold">¡Listo, gracias!</p>
        <p className="mt-1 text-neutral-700">
          Volvé a WhatsApp para confirmar tu turno.
        </p>
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            className="mt-4 inline-block rounded-xl bg-[#25D366] px-5 py-3 font-bold text-white"
          >
            Volver a WhatsApp
          </a>
        ) : null}
      </div>
    );
  }

  const campo =
    "mt-1 w-full rounded-xl border border-neutral-300 px-4 py-3 text-base outline-none focus:border-neutral-900";
  return (
    <form onSubmit={enviar} className="mt-6 space-y-4">
      <label className="block text-sm font-semibold">
        DNI
        <input
          name="documentNumber"
          required
          inputMode="numeric"
          autoComplete="off"
          maxLength={30}
          placeholder="Solo números"
          className={campo}
        />
      </label>
      <label className="block text-sm font-semibold">
        Fecha de nacimiento <span className="font-normal text-neutral-500">(opcional)</span>
        <input name="birthDate" type="date" className={campo} />
      </label>
      <label className="block text-sm font-semibold">
        Número de afiliado <span className="font-normal text-neutral-500">(opcional)</span>
        <input name="affiliateNumber" maxLength={60} autoComplete="off" className={campo} />
      </label>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-red-600">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={estado === "enviando"}
        className="w-full rounded-xl bg-neutral-900 px-5 py-3 text-base font-bold text-white disabled:opacity-60"
      >
        {estado === "enviando" ? "Guardando…" : "Confirmar"}
      </button>
    </form>
  );
}
