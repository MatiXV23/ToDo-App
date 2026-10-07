"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Board } from "@/components/board/filters";
import { useTRPC } from "@/lib/trpc";
import type { TaskDetail } from "./types";

type Patch = Partial<{
  title: string;
  descriptionMd: string;
  priority: TaskDetail["priority"];
  assigneeId: string | null;
  epicId: string | null;
  sprintId: string | null;
  dueDate: string | null;
  estimateHours: number | null;
  columnId: string;
  tagIds: string[];
}>;

/** Actualiza una tarea aplicando el cambio al instante en el detalle y en el tablero. */
export function useUpdateTask(task: TaskDetail, board: Board | undefined) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const taskQueryKey = trpc.task.get.queryKey({ taskId: task.id });
  const boardQueryKey = trpc.board.get.queryKey({ projectId: task.projectId });

  const mutation = useMutation(
    trpc.task.update.mutationOptions({
      onMutate: async (vars) => {
        const { taskId: _id, tagIds, ...fields } = vars;
        await Promise.all([
          queryClient.cancelQueries({ queryKey: taskQueryKey }),
          queryClient.cancelQueries({ queryKey: boardQueryKey }),
        ]);
        const previousTask = queryClient.getQueryData(taskQueryKey);
        const previousBoard = queryClient.getQueryData(boardQueryKey);
        const tags = tagIds && board ? board.tags.filter((t) => tagIds.includes(t.id)) : undefined;
        queryClient.setQueryData(taskQueryKey, (old) =>
          old ? { ...old, ...fields, ...(tags ? { tags: tags.map(({ id, name, color }) => ({ id, name, color })) } : {}) } : old,
        );
        queryClient.setQueryData(boardQueryKey, (old) =>
          old
            ? {
                ...old,
                tasks: old.tasks.map((t) =>
                  t.id === task.id
                    ? {
                        ...t,
                        ...(fields.title !== undefined ? { title: fields.title } : {}),
                        ...(fields.priority !== undefined ? { priority: fields.priority } : {}),
                        ...(fields.assigneeId !== undefined ? { assigneeId: fields.assigneeId } : {}),
                        ...(fields.epicId !== undefined ? { epicId: fields.epicId } : {}),
                        ...(fields.dueDate !== undefined ? { dueDate: fields.dueDate } : {}),
                        ...(fields.columnId !== undefined ? { columnId: fields.columnId } : {}),
                        ...(tagIds ? { tagIds } : {}),
                      }
                    : t,
                ),
              }
            : old,
        );
        return { previousTask, previousBoard };
      },
      onError: (_e, _v, ctx) => {
        if (ctx?.previousTask) queryClient.setQueryData(taskQueryKey, ctx.previousTask);
        if (ctx?.previousBoard) queryClient.setQueryData(boardQueryKey, ctx.previousBoard);
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: taskQueryKey });
        void queryClient.invalidateQueries({ queryKey: boardQueryKey });
        void queryClient.invalidateQueries(trpc.sprint.backlog.queryFilter({ projectId: task.projectId }));
      },
    }),
  );

  return (patch: Patch) => mutation.mutate({ taskId: task.id, ...patch });
}
