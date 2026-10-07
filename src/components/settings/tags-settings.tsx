"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ColorPicker } from "@/components/common/color-picker";
import type { ProjectInfo } from "@/components/project/project-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PALETTE } from "@/lib/domain";
import { useTRPC } from "@/lib/trpc";
import { SettingsCard } from "./settings-view";

export function TagsSettings({ project }: { project: ProjectInfo }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canManage = project.can.includes("tag.manage");
  const tags = useQuery(trpc.tag.list.queryOptions({ projectId: project.id }));
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[7]);

  const refresh = () => {
    void queryClient.invalidateQueries(trpc.tag.list.queryFilter({ projectId: project.id }));
    void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: project.id }));
  };
  const create = useMutation(trpc.tag.create.mutationOptions({ onSuccess: () => (setName(""), refresh()) }));
  const update = useMutation(trpc.tag.update.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.tag.delete.mutationOptions({ onSuccess: refresh }));

  return (
    <SettingsCard title="Tags" description="Etiquetas con color para clasificar tareas. Son propias de este proyecto.">
      {canManage ? (
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ projectId: project.id, name, color });
          }}
        >
          <div className="flex items-center">
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuevo tag" maxLength={30} />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            Agregar
          </Button>
        </form>
      ) : null}
      {tags.data?.length ? (
        <ul className="divide-y rounded-lg border">
          {tags.data.map((tag) => (
            <li key={tag.id} className="flex items-center gap-3 px-3 py-2">
              <ColorPicker
                value={tag.color}
                disabled={!canManage}
                onChange={(c) => update.mutate({ tagId: tag.id, color: c })}
              />
              <Input
                defaultValue={tag.name}
                disabled={!canManage}
                className="h-8 border-transparent shadow-none hover:bg-muted focus-visible:bg-background disabled:opacity-100"
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value && value !== tag.name) update.mutate({ tagId: tag.id, name: value });
                  else e.target.value = tag.name;
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Borrar ${tag.name}`}
                  onClick={() => window.confirm(`¿Borrar el tag "${tag.name}"? Se quita de todas las tareas.`) && remove.mutate({ tagId: tag.id })}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Todavía no hay tags.</p>
      )}
    </SettingsCard>
  );
}
