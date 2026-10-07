"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ProjectInfo } from "@/components/project/project-context";
import { TagsField } from "@/components/task/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COLUMN_CATEGORIES, COLUMN_CATEGORY_LABELS, type ColumnCategory } from "@/lib/domain";
import { type RouterOutputs, useTRPC } from "@/lib/trpc";
import { SettingsCard } from "./settings-view";

type BoardData = RouterOutputs["board"]["get"];

/** Tags automáticos de una columna, con estado local para encadenar varios cambios seguidos. */
function AutoTagsField({
  board,
  column,
  disabled,
  canCreate,
}: {
  board: BoardData;
  column: BoardData["columns"][number];
  disabled: boolean;
  canCreate: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // Mismo scope: varios cambios seguidos se envían en orden, uno por vez.
  const update = useMutation(
    trpc.column.update.mutationOptions({
      scope: { id: `column-auto-tags:${column.id}` },
      onSettled: () => queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: board.project.id })),
    }),
  );
  const serverKey = column.autoTagIds.join(",");
  const [value, setValue] = useState(column.autoTagIds);
  const [lastKey, setLastKey] = useState(serverKey);
  // Mientras haya cambios en camino, manda el estado local (el servidor todavía va atrás).
  if (serverKey !== lastKey && !update.isPending) {
    setLastKey(serverKey);
    setValue(column.autoTagIds);
  }
  return (
    <div className="w-44">
      <TagsField
        board={{ ...board, projectId: board.project.id }}
        value={value}
        disabled={disabled}
        canCreate={canCreate}
        emptyLabel="Sin tags automáticos"
        onChange={(ids) => {
          setValue(ids);
          update.mutate({ columnId: column.id, autoTagIds: ids });
        }}
      />
    </div>
  );
}

export function ColumnsSettings({ project }: { project: ProjectInfo }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canManage = project.can.includes("column.manage");
  const canCreateTags = project.can.includes("tag.manage");
  const board = useQuery(trpc.board.get.queryOptions({ projectId: project.id }));
  const columns = board.data?.columns ?? [];
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ColumnCategory>("in_progress");
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [target, setTarget] = useState<string>("");

  const refresh = () => queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: project.id }));
  const create = useMutation(trpc.column.create.mutationOptions({ onSuccess: () => (setName(""), refresh()) }));
  const update = useMutation(trpc.column.update.mutationOptions({ onSuccess: refresh }));
  const move = useMutation(trpc.column.move.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.column.delete.mutationOptions({ onSuccess: () => (setDeleting(null), refresh()) }));

  const countIn = (columnId: string) => board.data?.tasks.filter((t) => t.columnId === columnId).length ?? 0;

  return (
    <SettingsCard
      title="Columnas del tablero"
      description="La categoría indica qué cuenta como terminado, aunque renombres las columnas. Los tags automáticos se agregan a las tareas que se crean en la columna o entran a ella: por ejemplo, una columna “IA” con el tag del agente."
    >
      <ul className="divide-y rounded-lg border">
        {columns.map((column, index) => (
          <li key={column.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="flex flex-col">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Subir"
                disabled={!canManage || index === 0}
                onClick={() => move.mutate({ columnId: column.id, afterColumnId: columns[index - 2]?.id ?? null })}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Bajar"
                disabled={!canManage || index === columns.length - 1}
                onClick={() => move.mutate({ columnId: column.id, afterColumnId: columns[index + 1].id })}
              >
                <ArrowDown />
              </Button>
            </div>
            <Input
              key={column.name}
              defaultValue={column.name}
              disabled={!canManage}
              className="h-8 min-w-40 flex-1 border-transparent shadow-none hover:bg-muted focus-visible:bg-background disabled:opacity-100"
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== column.name) update.mutate({ columnId: column.id, name: value });
                else e.target.value = column.name;
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <Select
              value={column.category}
              disabled={!canManage}
              onValueChange={(v) => update.mutate({ columnId: column.id, category: v as ColumnCategory })}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUMN_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {COLUMN_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {board.data ? (
              <AutoTagsField
                board={board.data}
                column={column}
                disabled={!canManage}
                canCreate={canCreateTags}
              />
            ) : null}
            <span className="w-16 text-right text-xs text-muted-foreground">{countIn(column.id)} tareas</span>
            {canManage ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Borrar ${column.name}`}
                disabled={columns.length <= 1}
                onClick={() => {
                  setDeleting({ id: column.id, name: column.name });
                  setTarget(columns.find((c) => c.id !== column.id)?.id ?? "");
                }}
              >
                <Trash2 />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ projectId: project.id, name, category });
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nueva columna" className="min-w-48 flex-1" />
          <Select value={category} onValueChange={(v) => setCategory(v as ColumnCategory)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMN_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {COLUMN_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            Agregar columna
          </Button>
        </form>
      ) : null}

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Borrar “{deleting?.name}”</DialogTitle>
            <DialogDescription>
              {deleting && countIn(deleting.id) > 0
                ? `Sus ${countIn(deleting.id)} tareas se mueven a otra columna.`
                : "La columna está vacía."}{" "}
              Las automatizaciones que la usen dejarán de funcionar.
            </DialogDescription>
          </DialogHeader>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Mover tareas a…" />
            </SelectTrigger>
            <SelectContent>
              {columns
                .filter((c) => c.id !== deleting?.id)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    Mover tareas a {c.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!target || remove.isPending}
              onClick={() => deleting && remove.mutate({ columnId: deleting.id, moveTasksTo: target })}
            >
              Borrar columna
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
