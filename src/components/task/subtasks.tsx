"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import type { Board } from "@/components/board/filters";
import { UserAvatar } from "@/components/common/user-avatar";
import { Input } from "@/components/ui/input";
import { taskKey } from "@/lib/domain";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { TaskDetail } from "./types";

export function Subtasks({
  task,
  board,
  canEdit,
  onOpen,
  toolbar,
}: {
  task: TaskDetail;
  board: Board;
  canEdit: boolean;
  onOpen: (key: string) => void;
  toolbar?: React.ReactNode;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const invalidate = () => {
    void queryClient.invalidateQueries(trpc.task.get.queryFilter({ taskId: task.id }));
    void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: task.projectId }));
  };
  const create = useMutation(trpc.task.create.mutationOptions({ onSuccess: invalidate }));
  const update = useMutation(trpc.task.update.mutationOptions({ onSuccess: invalidate }));

  const firstTodo = board.columns.find((c) => c.category === "todo") ?? board.columns[0];
  const firstDone = board.columns.find((c) => c.category === "done");
  const columnName = (id: string) => board.columns.find((c) => c.id === id)?.name ?? "";
  const done = task.subtasks.filter((s) => s.completedAt).length;

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          Subtareas {task.subtasks.length ? `· ${done}/${task.subtasks.length}` : ""}
        </h3>
        <div className="ml-auto flex items-center gap-1">{toolbar}</div>
      </div>
      {task.subtasks.length ? (
        <>
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{ width: `${(done / task.subtasks.length) * 100}%` }}
            />
          </div>
          <ul className="divide-y rounded-lg border">
            {task.subtasks.map((s) => {
              const isDone = !!s.completedAt;
              const assignee = board.members.find((m) => m.id === s.assigneeId);
              return (
                <li key={s.id} className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    disabled={!canEdit || !firstDone}
                    aria-label={isDone ? "Marcar como pendiente" : "Marcar como hecha"}
                    onClick={() =>
                      update.mutate({ taskId: s.id, columnId: isDone ? firstTodo.id : firstDone!.id })
                    }
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                      isDone ? "border-green-500 bg-green-500 text-white" : "hover:border-foreground/40",
                    )}
                  >
                    {isDone ? <Check className="size-3" /> : null}
                  </button>
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                    onClick={() => onOpen(taskKey(task.projectKey, s.number))}
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">{taskKey(task.projectKey, s.number)}</span>
                    <span className={cn("truncate", isDone && "text-muted-foreground line-through")}>{s.title}</span>
                  </button>
                  <span className="hidden rounded bg-muted px-1.5 text-[11px] text-muted-foreground sm:inline">
                    {columnName(s.columnId)}
                  </span>
                  {assignee ? <UserAvatar user={assignee} className="size-5" tooltip /> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {canEdit && !task.parentId ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            create.mutate({ projectId: task.projectId, parentId: task.id, title: title.trim(), columnId: firstTodo.id });
            setTitle("");
          }}
        >
          <Plus className="size-4 text-muted-foreground" />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Agregar subtarea"
            className="h-8 border-transparent px-1 shadow-none hover:bg-muted/50 focus-visible:bg-background"
          />
        </form>
      ) : null}
    </section>
  );
}
