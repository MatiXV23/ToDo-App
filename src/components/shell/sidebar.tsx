"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Inbox, KeyRound, LayoutGrid, LogOut, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/common/logo";
import { UserAvatar } from "@/components/common/user-avatar";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { promptInstall, useCanInstall } from "@/lib/pwa";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "./current-user";

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
        active && "bg-sidebar-accent font-medium text-sidebar-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export function Sidebar() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();
  const trpc = useTRPC();
  const [creating, setCreating] = useState(false);
  const canInstall = useCanInstall();
  const projects = useQuery(trpc.project.list.queryOptions());
  const unread = useQuery(trpc.notification.unreadCount.queryOptions());
  const pendingAccess = useQuery(trpc.access.pendingCount.queryOptions(undefined, { enabled: user.isAdmin }));
  const active = (projects.data ?? []).filter((p) => !p.archivedAt);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 px-4">
        <Logo className="size-6" />
        <span className="text-sm font-semibold">ToDoApp</span>
      </div>

      <nav className="space-y-0.5 px-2">
        <NavLink href="/" active={pathname === "/"}>
          <LayoutGrid className="size-4" /> Proyectos
        </NavLink>
        <NavLink href="/inbox" active={pathname === "/inbox"}>
          <Inbox className="size-4" /> Buzón
          {unread.data ? (
            <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] font-medium leading-5 text-white">
              {unread.data > 99 ? "99+" : unread.data}
            </span>
          ) : null}
        </NavLink>
        {user.isAdmin ? (
          <NavLink href="/admin/access" active={pathname === "/admin/access"}>
            <ShieldCheck className="size-4" /> Acceso a la app
            {pendingAccess.data ? (
              <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] font-medium leading-5 text-white">
                {pendingAccess.data}
              </span>
            ) : null}
          </NavLink>
        ) : null}
      </nav>

      <div className="mt-6 flex items-center justify-between px-4">
        <span className="text-xs font-medium text-muted-foreground">Proyectos</span>
        <Button variant="ghost" size="icon-xs" onClick={() => setCreating(true)} aria-label="Nuevo proyecto">
          <Plus />
        </Button>
      </div>
      <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {active.map((p) => (
          <NavLink key={p.id} href={`/p/${p.key}`} active={pathname.startsWith(`/p/${p.key}`)}>
            <span className="flex h-5 min-w-8 items-center justify-center rounded bg-sidebar-accent px-1 font-mono text-[10px] text-muted-foreground">
              {p.key}
            </span>
            <span className="truncate">{p.name}</span>
          </NavLink>
        ))}
        {projects.isSuccess && active.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">Todavía no hay proyectos.</p>
        ) : null}
      </div>

      <div className="border-t p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-sidebar-accent">
              <UserAvatar user={user} className="size-7" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/tokens">
                <KeyRound /> Tokens de API (Claude Code)
              </Link>
            </DropdownMenuItem>
            {canInstall ? (
              <DropdownMenuItem onSelect={() => void promptInstall()}>
                <Download /> Instalar app
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onSelect={async () => {
                await authClient.signOut();
                router.replace("/login");
                router.refresh();
              }}
            >
              <LogOut /> Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
