"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FlaskConical,
  Inbox,
  Kanban,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import { useEvents } from "@/components/use-events";

const NAV = [
  { href: "/inbox", label: "Bandeja", icon: Inbox, badge: true },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/agent", label: "Agente", icon: Sparkles },
  { href: "/lab", label: "Laboratorio", icon: FlaskConical },
] as const;

export function AppNav({
  branding,
  userName,
  role,
}: {
  branding: Branding;
  userName: string;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cierra el menú mobile al navegar a otra sección.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function refetchUnread() {
    const res = await fetch("/api/conversations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as {
      conversations: { unreadCount: number }[];
    };
    setUnread(data.conversations.reduce((a, c) => a + c.unreadCount, 0));
  }

  useEffect(() => {
    void refetchUnread();
  }, []);

  useEvents({
    onMessageNew: () => void refetchUnread(),
    onConversationUpdated: () => void refetchUnread(),
  });

  return (
    <>
      <button
        aria-label="Abrir menú"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-sm border bg-background text-text-2 shadow-sm md:hidden"
      >
        <Menu className="h-[18px] w-[18px]" strokeWidth={1.7} />
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 -translate-x-full flex-col border-r bg-subtle px-3 pb-3.5 pt-4 transition-transform duration-200",
          "md:static md:z-auto md:w-56 md:translate-x-0",
          mobileOpen && "translate-x-0"
        )}
      >
        <button
          aria-label="Cerrar menú"
          onClick={() => setMobileOpen(false)}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-sm text-text-3 hover:bg-accent md:hidden"
        >
          <X className="h-4 w-4" strokeWidth={1.7} />
        </button>
        <div className="mb-4 flex items-center gap-2.5 px-2">
          <span
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm bg-brand text-[15px] font-bold text-white"
            aria-hidden
          >
            {branding.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[16px] font-[650] leading-tight tracking-tight">
              {branding.name}
            </span>
            <span className="block text-[11px] text-text-3">CRM · WhatsApp</span>
          </span>
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-[11px] rounded-sm px-2.5 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-tint font-semibold text-brand-text"
                    : "text-text-2 hover:bg-accent"
                )}
              >
                <item.icon
                  className={cn("h-[18px] w-[18px]", active ? "text-brand" : "text-text-3")}
                  strokeWidth={1.7}
                />
                <span className="flex-1">{item.label}</span>
                {"badge" in item && item.badge && unread > 0 && (
                  <span
                    className={cn(
                      "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold",
                      active ? "bg-brand text-white" : "bg-border-strong text-text-2"
                    )}
                  >
                    {unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-[11px] rounded-sm px-2.5 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-brand-tint font-semibold text-brand-text"
              : "text-text-2 hover:bg-accent"
          )}
        >
          <Settings
            className={cn(
              "h-[18px] w-[18px]",
              pathname.startsWith("/settings") ? "text-brand" : "text-text-3"
            )}
            strokeWidth={1.7}
          />
          Ajustes
        </Link>

        <div className="mt-1 flex items-center gap-2.5 rounded-sm px-2.5 py-2 hover:bg-accent">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
            {initials(userName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{userName}</span>
            <span className="block text-[11px] text-text-3">
              {role === "owner" ? "Propietario" : "Equipo"} · En línea
            </span>
          </span>
          <button
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="rounded p-1 text-text-3 hover:text-foreground"
            onClick={async () => {
              await signOut();
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      </aside>
    </>
  );
}
