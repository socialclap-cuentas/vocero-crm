"use client";

import { useState } from "react";
import { MessageSquarePlus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Sala de chat de la demo. El prospecto escribe como si fuera el paciente y el
 * agente le contesta en la bandeja de siempre: sin WhatsApp, con el mismo
 * pipeline, notas y agenda que en producción. Solo se monta con DEMO_MODE.
 */

/** Teléfonos de la demo (mismo prefijo que `server/demo/chat.ts`). */
const PREFIJO_DEMO = "5491199";
export const esSalaDeDemo = (phone: string | null) =>
  !!phone && phone.startsWith(PREFIJO_DEMO);

export function DemoNuevaSala({
  onCreada,
}: {
  onCreada: (conversationId: string) => void;
}) {
  const [creando, setCreando] = useState(false);
  async function crear() {
    setCreando(true);
    const res = await fetch("/api/demo/chat", { method: "POST" }).catch(() => null);
    setCreando(false);
    if (!res?.ok) return;
    const data = (await res.json()) as { conversationId: string };
    onCreada(data.conversationId);
  }
  return (
    <div className="border-b bg-accent/40 px-3 py-3">
      <Button
        className="w-full"
        disabled={creando}
        onClick={() => void crear()}
      >
        <MessageSquarePlus className="mr-2 h-4 w-4" strokeWidth={1.8} />
        {creando ? "Abriendo…" : "Probar como paciente"}
      </Button>
      <p className="mt-2 text-[12px] leading-snug text-text-2">
        Escribí como si fueras un paciente y mirá cómo el agente te atiende,
        agenda y mueve el tablero. No se envía nada a WhatsApp.
      </p>
    </div>
  );
}

export function DemoPaciente({
  conversationId,
  onEnviado,
}: {
  conversationId: string;
  onEnviado: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    const res = await fetch(`/api/demo/chat/${conversationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: t }),
    }).catch(() => null);
    setEnviando(false);
    if (res?.ok) {
      setTexto("");
      onEnviado();
    }
  }
  return (
    <div className="border-t bg-accent/40 px-3 py-2.5 md:px-4">
      <p className="mb-1.5 text-[12px] font-medium text-text-2">
        Estás hablando como el paciente
      </p>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={1000}
          placeholder="Escribí tu mensaje como paciente…"
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" disabled={enviando || !texto.trim()}>
          <Send className="h-4 w-4" strokeWidth={1.8} />
          <span className="sr-only">Enviar como paciente</span>
        </Button>
      </form>
    </div>
  );
}
