"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AiDescriptionActions, AiSplitAction, AiSuggestFieldsAction } from "@/components/ai/ai-task-actions";
import type { Board } from "@/components/board/filters";
import { useCan, useProject } from "@/components/project/project-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useTaskParam } from "@/hooks/use-task-param";
import { parseTaskKey } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { Activity } from "./activity";
import { Comments } from "./comments";
import { DescriptionEditor } from "./description-editor";
import {
  AssigneeField,
  ColumnField,
  DateField,
  EpicField,
  HoursField,
  PriorityField,
  SprintField,
  TagsField,
} from "./fields";
import { Subtasks } from "./subtasks";
import type { TaskDetail } from "./types";
import { useUpdateTask } from "./use-update-task";
import { VcsPanel } from "./vcs-panel";

export function TaskSheet() {
  const project = useProject();
  const trpc = useTRPC();
  const { taskKey, openTask, closeTask } = useTaskParam();
  const parsed = taskKey ? parseTaskKey(taskKey) : null;
  const valid = parsed && parsed.projectKey === project.key;

  const idQuery = useQuery({
    ...trpc.task.findId.queryOptions({ projectId: project.id, number: parsed?.number ?? 0 }),
    enabled: !!valid,
    staleTime: Infinity,
  });
  const taskQuery = useQuery({
    ...trpc.task.get.queryOptions({ taskId: idQuery.data ?? "" }),
    enabled: !!idQuery.data,
  });
  const board = useQuery(trpc.board.get.queryOptions({ projectId: project.id }));

  return (
    <Sheet open={!!valid} onOpenChange={(open) => !open && closeTask()}>
      <SheetContent className="@container gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl" aria-describedby={undefined}>
        <SheetTitle className="sr-only">{taskKey ?? "Tarea"}</SheetTitle>
        {idQuery.isError || taskQuery.isError ? (
          <div className="p-8 text-sm text-muted-foreground">
            <SheetDescription>La tarea no existe o fue borrada.</SheetDescription>
          </div>
        ) : taskQuery.data && board.data ? (
          <TaskDetailView task={taskQuery.data} board={board.data} onOpen={openTask} onClose={closeTask} />
        ) : (
          <div className="space-y-4 p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TitleEditor({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled: boolean }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };
  return (
    <Textarea
      value={draft}
      disabled={disabled}
      rows={1}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(value);
          e.stopPropagation();
        }
      }}
      className="min-h-0 resize-none overflow-hidden border-transparent px-2 py-1 text-xl font-semibold shadow-none hover:bg-muted/50 focus-visible:bg-background disabled:opacity-100 md:text-xl"
    />
  );
}

function TaskDetailView({
  task,
  board,
  onOpen,
  onClose,
}: {
  task: TaskDetail;
  board: Board;
  onOpen: (key: string) => void;
  onClose: () => void;
}) {
  const can = useCan();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const update = useUpdateTask(task, board);
  const canEdit = can("task.update");
  const lookups = { ...board, projectId: board.project.id };

  const restore = useMutation(
    trpc.task.restore.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: task.projectId })),
    }),
  );
  const remove = useMutation(
    trpc.task.delete.mutationOptions({
      onSuccess: () => {
        onClose();
        void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: task.projectId }));
        toast(`${task.key} borrada`, {
          action: { label: "Deshacer", onClick: () => restore.mutate({ taskId: task.id }) },
        });
      },
    }),
  );

  const row = (label: string, field: React.ReactNode) => (
    <div className="group/field grid grid-cols-[5.5rem_1fr] items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{field}</div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b px-4 py-2.5 pr-12 text-sm">
        {task.parent ? (
          <>
            <button className="font-mono text-xs text-muted-foreground hover:text-foreground" onClick={() => onOpen(task.parent!.key)}>
              {task.parent.key}
            </button>
            <ChevronRight className="size-3.5 text-muted-foreground" />
          </>
        ) : null}
        <span className="font-mono text-xs font-medium">{task.key}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copiar enlace"
            onClick={async () => {
              await navigator.clipboard.writeText(window.location.href);
              toast.success("Enlace copiado");
            }}
          >
            <Link2 />
          </Button>
          {can("task.delete") ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Más acciones">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(task.key)}>Copiar clave</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate({ taskId: task.id })}>
                  <Trash2 /> Borrar tarea
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-6 p-4 @2xl:grid-cols-[1fr_17rem] @2xl:p-6">
          <div className="min-w-0 space-y-6">
            <TitleEditor value={task.title} onSave={(title) => update({ title })} disabled={!canEdit} />
            <DescriptionEditor
              value={task.descriptionMd}
              onSave={(descriptionMd) => update({ descriptionMd })}
              disabled={!canEdit}
              toolbar={canEdit ? <AiDescriptionActions task={task} onApply={(descriptionMd) => update({ descriptionMd })} /> : null}
            />
            {!task.parentId || task.subtasks.length ? (
              <Subtasks
                task={task}
                board={board}
                canEdit={can("task.create")}
                onOpen={onOpen}
                toolbar={can("task.create") && !task.parentId ? <AiSplitAction target={{ kind: "task", task }} /> : null}
              />
            ) : null}
            <Tabs defaultValue="comments">
              <TabsList variant="line" className="mb-3">
                <TabsTrigger value="comments">Comentarios {task.comments.length ? `(${task.comments.length})` : ""}</TabsTrigger>
                <TabsTrigger value="activity">Historial</TabsTrigger>
                <TabsTrigger value="vcs">GitHub {task.links.length ? `(${task.links.length})` : ""}</TabsTrigger>
              </TabsList>
              <TabsContent value="comments">
                <Comments task={task} canComment={can("comment.create")} canModerate={can("comment.moderate")} />
              </TabsContent>
              <TabsContent value="activity">
                <Activity task={task} />
              </TabsContent>
              <TabsContent value="vcs">
                <VcsPanel task={task} />
              </TabsContent>
            </Tabs>
          </div>

          <aside className="space-y-1 @2xl:order-none @2xl:border-l @2xl:pl-4">
            {row("Estado", <ColumnField board={lookups} value={task.columnId} onChange={(columnId) => update({ columnId })} disabled={!canEdit} />)}
            {row(
              "Responsable",
              <AssigneeField board={lookups} value={task.assigneeId} onChange={(assigneeId) => update({ assigneeId })} disabled={!canEdit} />,
            )}
            {row("Prioridad", <PriorityField value={task.priority} onChange={(priority) => update({ priority })} disabled={!canEdit} />)}
            {row("Epic", <EpicField board={lookups} value={task.epicId} onChange={(epicId) => update({ epicId })} disabled={!canEdit} />)}
            {task.sprintsEnabled && !task.parentId
              ? row(
                  "Sprint",
                  <SprintField board={lookups} value={task.sprintId} onChange={(sprintId) => update({ sprintId })} disabled={!can("sprint.manage")} />,
                )
              : null}
            {row(
              "Tags",
              <TagsField
                board={lookups}
                value={task.tags.map((t) => t.id)}
                onChange={(tagIds) => update({ tagIds })}
                disabled={!canEdit}
                canCreate={can("tag.manage")}
              />,
            )}
            {row("Fecha límite", <DateField value={task.dueDate} onChange={(dueDate) => update({ dueDate })} disabled={!canEdit} />)}
            {row(
              "Estimación",
              <HoursField value={task.estimateHours} onChange={(estimateHours) => update({ estimateHours })} disabled={!canEdit} />,
            )}
            {canEdit ? (
              <div className="pt-2">
                <AiSuggestFieldsAction task={task} board={board} onApply={update} />
              </div>
            ) : null}
            <div className="space-y-1 pt-4 text-[11px] text-muted-foreground">
              <p>Creada {formatDateTime(task.createdAt)}</p>
              <p>Actualizada {formatDateTime(task.updatedAt)}</p>
              {task.completedAt ? <p>Terminada {formatDateTime(task.completedAt)}</p> : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
