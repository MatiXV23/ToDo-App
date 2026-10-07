"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useRealtime } from "@/hooks/use-realtime";
import type { SessionUser } from "@/server/auth";
import { CurrentUserProvider } from "./current-user";
import { Sidebar } from "./sidebar";

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useRealtime();

  // Cerrar el menú móvil al navegar.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  return (
    <CurrentUserProvider user={user}>
      <div className="flex h-dvh overflow-hidden">
        <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:flex md:flex-col">
          <Sidebar />
        </aside>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 bg-sidebar p-0">
            <SheetTitle className="sr-only">Menú</SheetTitle>
            <Sidebar />
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 items-center gap-2 border-b px-3 md:hidden">
            <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(true)} aria-label="Abrir menú">
              <Menu />
            </Button>
            <span className="text-sm font-semibold">ToDoApp</span>
          </div>
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </CurrentUserProvider>
  );
}
