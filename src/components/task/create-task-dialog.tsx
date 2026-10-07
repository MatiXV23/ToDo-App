"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Board } from "@/components/board/filters";
import { useCan } from "@/components/project/project-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Priority } from "@/lib/domain";
import { useTRPC } from "@/lib/trpc";
import { AssigneeField, ColumnField, DateField, EpicField, PriorityField, TagsField } from "./fields";

type Draft = {
  title: string;
  descriptionMd: string;
  columnId: string;
  assigneeId: string | null;
  priority: Priority;
  epicId: string | null;
  tagIds: string[];
  dueDate: string | null;
};

export function CreateTaskDialog({
  open,
  onOpenChange,
  board,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Board;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const initial = (): Draft => ({
    title: "",
    descriptionMd: "",
    columnId: board.columns[0]?.id ?? "",
    assigneeId: null,
    priority: "medium",
    epicId: null,
    tagIds: [],
    dueDate: null,
  });
  const [draft, setDraft] = useState<Draft>(initial);
  const [another, setAnother] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const lookups = { ...board, projectId: board.project.id };

  const create = useMutation(
    trpc.task.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: board.project.id }));
        if (another) setDraft((d) => ({ ...initial(), columnId: d.columnId, epicId: d.epicId, assigneeId: d.assigneeId }));
        else {
          setDraft(initial());
          onOpenChange(false);
        }
      },
    }),
  );

  const row = (label: string, field: React.ReactNode) => (
    <div className="group/field grid grid-cols-[6.5rem_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {field}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              projectId: board.project.id,
              ...draft,
              sprintId: board.activeSprint?.id ?? null,
            });
          }}
        >
          <Input
            autoFocus
            placeholder="Título"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            className="text-base"
          />
          <Textarea
            placeholder="Descripción (Markdown)"
            rows={4}
            value={draft.descriptionMd}
            onChange={(e) => set("descriptionMd", e.target.value)}
          />
          <div className="grid gap-1 sm:grid-cols-2 sm:gap-x-6">
            {row("Estado", <ColumnField board={lookups} value={draft.columnId} onChange={(v) => set("columnId", v)} />)}
            {row("Responsable", <AssigneeField board={lookups} value={draft.assigneeId} onChange={(v) => set("assigneeId", v)} />)}
            {row("Prioridad", <PriorityField value={draft.priority} onChange={(v) => set("priority", v)} />)}
            {row("Epic", <EpicField board={lookups} value={draft.epicId} onChange={(v) => set("epicId", v)} />)}
            {row(
              "Tags",
              <TagsField board={lookups} value={draft.tagIds} onChange={(v) => set("tagIds", v)} canCreate={can("tag.manage")} />,
            )}
            {row("Fecha límite", <DateField value={draft.dueDate} onChange={(v) => set("dueDate", v)} />)}
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} />
              Crear otra
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!draft.title.trim() || create.isPending}>
                Crear tarea
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
