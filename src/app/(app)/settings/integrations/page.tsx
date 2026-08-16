import { Suspense } from "react";
import { IntegrationsSettings } from "@/components/settings/integrations-settings";

export const dynamic = "force-dynamic";

export default function IntegrationsSettingsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
      <IntegrationsSettings />
    </Suspense>
  );
}
