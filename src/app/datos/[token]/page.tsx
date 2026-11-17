import type { Metadata } from "next";
import { viewDataLink } from "@/server/salud/enlace-datos";
import { DatosForm } from "./datos-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Completá tus datos",
  robots: { index: false, follow: false },
};

const MENSAJES = {
  invalid: "Este enlace no es válido. Pedile a quien te atendió que te mande uno nuevo.",
  expired: "Este enlace venció. Escribinos por WhatsApp y te mandamos uno nuevo.",
  used: "Ya completaste tus datos con este enlace. Podés volver a WhatsApp.",
} as const;

export default async function DatosPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await viewDataLink(token);

  return (
    <main className="min-h-screen bg-white px-5 py-10 text-neutral-900">
      <div className="mx-auto max-w-md">
        {view.state === "ok" ? (
          <>
            <p className="text-sm font-semibold text-neutral-500">{view.businessName}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              {view.contactName ? `Hola, ${view.contactName.split(" ")[0]}` : "Completá tus datos"}
            </h1>
            <p className="mt-3 text-neutral-600">
              Para confirmar tu turno necesitamos tu documento. Lo pedimos acá y no por
              WhatsApp para cuidar tus datos. Te lleva 30 segundos.
            </p>
            {view.insuranceName ? (
              <p className="mt-4 rounded-xl bg-neutral-100 px-4 py-3 text-sm">
                Obra social: <strong>{view.insuranceName}</strong>
              </p>
            ) : null}
            <DatosForm token={token} whatsappUrl={view.whatsappUrl} />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Enlace no disponible</h1>
            <p className="mt-3 text-neutral-600">{MENSAJES[view.state]}</p>
          </>
        )}
        <p className="mt-10 text-xs text-neutral-400">
          Tus datos se guardan en la ficha administrativa del consultorio. No pedimos ni
          guardamos información médica.
        </p>
      </div>
    </main>
  );
}
