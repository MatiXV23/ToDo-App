"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { ProjectInfo } from "@/components/project/project-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/lib/trpc";
import { SettingsCard } from "./settings-view";

export function GeneralSettings({ project }: { project: ProjectInfo }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const canEdit = project.can.includes("project.update");
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [confirmKey, setConfirmKey] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries(trpc.project.pathFilter());
    void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: project.id }));
  };
  const update = useMutation(trpc.project.update.mutationOptions({ onSuccess: refresh }));
  const archive = useMutation(trpc.project.setArchived.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(
    trpc.project.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Proyecto borrado");
        void queryClient.invalidateQueries(trpc.project.pathFilter());
        router.push("/");
      },
    }),
  );

  return (
    <div className="space-y-6">
      <SettingsCard title="Proyecto">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(
              { projectId: project.id, name, description },
              { onSuccess: () => toast.success("Cambios guardados") },
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Clave</Label>
              <Input value={project.key} disabled className="font-mono" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              value={description}
              disabled={!canEdit}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {canEdit ? (
            <Button type="submit" disabled={update.isPending || (name === project.name && description === project.description)}>
              Guardar
            </Button>
          ) : null}
        </form>
      </SettingsCard>

      <SettingsCard title="Sprints" description="Con sprints, el tablero muestra el sprint activo y el resto vive en el backlog.">
        <label className="flex items-center gap-3 text-sm">
          <Switch
            checked={project.sprintsEnabled}
            disabled={!canEdit}
            onCheckedChange={(sprintsEnabled) => update.mutate({ projectId: project.id, sprintsEnabled })}
          />
          {project.sprintsEnabled ? "Sprints activados" : "Sprints desactivados (tablero Kanban)"}
        </label>
      </SettingsCard>

      {project.can.includes("project.archive") ? (
        <SettingsCard title="Zona peligrosa" className="border-destructive/30">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{project.archivedAt ? "Desarchivar proyecto" : "Archivar proyecto"}</p>
                <p className="text-sm text-muted-foreground">Los proyectos archivados no aparecen en la barra lateral.</p>
              </div>
              <Button
                variant="outline"
                onClick={() => archive.mutate({ projectId: project.id, archived: !project.archivedAt })}
              >
                {project.archivedAt ? "Desarchivar" : "Archivar"}
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Borrar proyecto</p>
              <p className="text-sm text-muted-foreground">
                Borra el proyecto con todas sus tareas, epics, sprints y automatizaciones. No se puede deshacer. Escribí{" "}
                <span className="font-mono font-medium text-foreground">{project.key}</span> para confirmar.
              </p>
              <div className="flex gap-2">
                <Input
                  value={confirmKey}
                  onChange={(e) => setConfirmKey(e.target.value)}
                  placeholder={project.key}
                  className="max-w-40 font-mono"
                />
                <Button
                  variant="destructive"
                  disabled={confirmKey.toUpperCase() !== project.key || remove.isPending}
                  onClick={() => remove.mutate({ projectId: project.id, confirmKey })}
                >
                  Borrar definitivamente
                </Button>
              </div>
            </div>
          </div>
        </SettingsCard>
      ) : null}
    </div>
  );
}
