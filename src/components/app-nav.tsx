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
      {/* Botón hamburguesa: solo visible en pantallas chicas (mobile) */}
      <button
        aria-label="Abrir menú"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-sm border bg-background text-text-2 shadow-sm md:hidden"
      >
        <Menu className="h-[18px] w-[18px]" strokeWidth={1.7} />
      </button>

      {/* Overlay oscuro detrás del menú cuando está abierto en mobile */}
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
        {/* Brand white-label */}
      <div className="mb-4 flex items-center gap-2.5 px-2">
        <span
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm bg-brand text-[15px] font-bold text-white"
          aria-hidden
        >
          {branding.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate
