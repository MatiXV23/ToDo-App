"use client";

import { useQuery } from "@tanstack/react-query";
import { FolderX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { TaskSheet } from "@/components/task/task-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRealtime } from "@/hooks/use-realtime";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ProjectProvider, type ProjectInfo } from "./project-context";

function ProjectTabs({ project }: { project: ProjectInfo }) {
  const pathname = usePathname();
  const base = `/p/${project.key}`;
  const tabs = [
    { href: base, label: "Tablero" },
    ...(project.sprintsEnabled ? [{ href: `${base}/backlog`, label: "Backlog" }] : []),
    { href: `${base}/epics`, label: "Epics" },
    { href: `${base}/automations`, label: "Automatizaciones" },
    { href: `${base}/settings`, label: "Ajustes" },
  ];
  return (
    <nav className="-mb-px flex gap-4 overflow-x-auto">
      {tabs.map((tab) => {
        const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 border-transparent pb-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              active && "border-foreground font-medium text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ProjectRealtime({ projectId }: { projectId: string }) {
  useRealtime(projectId);
  return null;
}

export function ProjectShell({ projectKey, children }: { projectKey: string; children: React.ReactNode }) {
  const trpc = useTRPC();
  const project = useQuery(trpc.project.byKey.queryOptions({ key: projectKey }));

  if (project.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
        <div className="flex gap-4 pt-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-96 w-72 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  if (!project.data) {
    return (
      <div className="p-8">
        <EmptyState
          icon={FolderX}
          title="Proyecto no encontrado"
          description="No existe o no tenés acceso. Si te invitaron, aceptá la invitación desde el buzón."
          action={
            <Button asChild variant="outline">
              <Link href="/">Ver mis proyectos</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const data = project.data;
  return (
    <ProjectProvider project={data}>
      <ProjectRealtime projectId={data.id} />
      <div className="flex h-full flex-col">
        <header className="border-b px-4 pt-4 md:px-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{data.key}</span>
            <h1 className="truncate text-base font-semibold">{data.name}</h1>
            {data.archivedAt ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">Archivado</span>
            ) : null}
          </div>
          <ProjectTabs project={data} />
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
      <Suspense>
        <TaskSheet />
      </Suspense>
    </ProjectProvider>
  );
}
