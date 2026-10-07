"use client";

import { useQuery } from "@tanstack/react-query";
import { Archive, FolderKanban, Mail, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { ROLE_LABELS } from "@/server/permissions/labels";
import { CreateProjectDialog } from "./create-project-dialog";
import { InvitationActions } from "./invitation-actions";

export function ProjectsHome() {
  const trpc = useTRPC();
  const [creating, setCreating] = useState(false);
  const projects = useQuery(trpc.project.list.queryOptions());
  const invitations = useQuery(trpc.member.myInvitations.queryOptions());
  const active = (projects.data ?? []).filter((p) => !p.archivedAt);
  const archived = (projects.data ?? []).filter((p) => p.archivedAt);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Proyectos</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus /> Nuevo proyecto
        </Button>
      </div>

      {invitations.data?.length ? (
        <section className="mb-8 space-y-2">
          {invitations.data.map((inv) => (
            <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-brand/5 p-3">
              <Mail className="size-4 text-brand" />
              <UserAvatar user={inv.invitedBy} />
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{inv.invitedBy.name}</span> te invitó a{" "}
                <span className="font-medium">{inv.project.name}</span> como {ROLE_LABELS[inv.role].toLowerCase()}.
              </p>
              <InvitationActions invitationId={inv.id} />
            </div>
          ))}
        </section>
      ) : null}

      {projects.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : active.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Creá tu primer proyecto"
          description="Un proyecto agrupa tareas, epics y sprints. Podés invitar a otras personas cuando quieras."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nuevo proyecto
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((p) => (
            <Link
              key={p.id}
              href={`/p/${p.key}`}
              className="group flex flex-col rounded-xl border p-4 transition-colors hover:border-foreground/20 hover:bg-muted/40"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{p.key}</span>
                <span className="ml-auto text-xs text-muted-foreground">{ROLE_LABELS[p.role]}</span>
              </div>
              <h2 className="mt-2 truncate font-medium">{p.name}</h2>
              <p className="mt-0.5 line-clamp-2 min-h-10 text-sm text-muted-foreground">{p.description || " "}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                {p.openTasks === 0 ? "Sin tareas abiertas" : `${p.openTasks} ${p.openTasks === 1 ? "tarea abierta" : "tareas abiertas"}`}
              </p>
            </Link>
          ))}
        </div>
      )}

      {archived.length ? (
        <section className="mt-10">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Archive className="size-4" /> Archivados
          </h2>
          <div className="divide-y rounded-xl border">
            {archived.map((p) => (
              <Link key={p.id} href={`/p/${p.key}/settings`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                <span className="font-mono text-[11px] text-muted-foreground">{p.key}</span>
                <span className="truncate">{p.name}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
