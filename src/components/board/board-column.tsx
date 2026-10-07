"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TagChip } from "@/components/common/chips";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Board } from "./filters";
import { QuickAdd } from "./quick-add";
import { type CardLookups, SortableTaskCard } from "./task-card";

type Props = {
  column: Board["columns"][number];
  taskIds: string[];
  lookups: CardLookups;
  canEdit: boolean;
  canCreate: boolean;
  projectId: string;
  sprintId: string | null;
  onOpen: (key: string) => void;
};

export function BoardColumn({ column, taskIds, lookups, canEdit, canCreate, projectId, sprintId, onOpen }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, data: { type: "column" } });
  const autoTags = column.autoTagIds.map((id) => lookups.tags.get(id)).filter((t) => !!t);
  return (
    <section className="flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-muted/50">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          className={cn(
            "size-2 rounded-full",
            column.category === "todo" && "bg-zinc-400",
            column.category === "in_progress" && "bg-brand",
            column.category === "done" && "bg-green-500",
          )}
        />
        <h2 className="truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">{column.name}</h2>
        <span className="text-xs text-muted-foreground">{taskIds.length}</span>
        {autoTags.length ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto flex min-w-0 shrink items-center gap-1 overflow-hidden">
                {autoTags.map((t) => (
                  <TagChip key={t.id} tag={t} />
                ))}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Las tareas que se crean acá o entran a esta columna reciben {autoTags.length > 1 ? "estos tags" : "este tag"}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          "scrollbar-thin flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors",
          isOver && "bg-muted",
        )}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {taskIds.map((id) => {
            const task = lookups.tasks.get(id);
            return task ? (
              <SortableTaskCard key={id} task={task} lookups={lookups} onOpen={onOpen} disabled={!canEdit} />
            ) : null;
          })}
        </SortableContext>
      </div>
      {canCreate ? (
        <div className="px-2 pb-2">
          <QuickAdd projectId={projectId} columnId={column.id} sprintId={sprintId} />
        </div>
      ) : null}
    </section>
  );
}
