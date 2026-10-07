"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Target } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCan } from "@/components/project/project-context";
import { AiSummaryButton } from "@/components/ai/ai-summary-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { Board } from "./filters";

export function SprintBar({ board }: { board: Board }) {
  const sprint = board.activeSprint!;
  const can = useCan();
  const [completing, setCompleting] = useState(false);
  const parents = board.tasks.filter((t) => !t.parentId);
  const done = parents.filter((t) => t.completedAt).length;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-4 py-2 text-sm md:px-6">
      <span className="font-medium">{sprint.name}</span>
      {sprint.startDate || sprint.endDate ? (
        <span className="text-muted-foreground">
          {sprint.startDate ? formatDate(sprint.startDate) : "?"} – {sprint.endDate ? formatDate(sprint.endDate) : "?"}
        </span>
      ) : null}
      {sprint.goal ? (
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
          <Target className="size-3.5 shrink-0" />
          <span className="truncate">{sprint.goal}</span>
        </span>
      ) : null}
      <span className="text-muted-foreground">
        {done}/{parents.length} terminadas
      </span>
      <div className="ml-auto flex gap-2">
        <AiSummaryButton scope={{ kind: "sprint", sprintId: sprint.id }} />
        {can("sprint.manage") ? (
          <Button size="xs" variant="outline" onClick={() => setCompleting(true)}>
            <CheckCircle2 /> Completar sprint
          </Button>
        ) : null}
      </div>
      <CompleteSprintDialog board={board} open={completing} onOpenChange={setCompleting} />
    </div>
  );
}

export function CompleteSprintDialog({
  board,
  open,
  onOpenChange,
}: {
  board: Pick<Board, "activeSprint" | "sprints" | "tasks" | "project">;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const sprint = board.activeSprint;
  const planned = board.sprints.filter((s) => s.status === "planned");
  const [target, setTarget] = useState<string>("backlog");
  const open_ = board.tasks.filter((t) => !t.parentId && !t.completedAt).length;
  const complete = useMutation(
    trpc.sprint.complete.mutationOptions({
      onSuccess: (r) => {
        toast.success(`Sprint cerrado${r.movedTasks ? ` · ${r.movedTasks} tareas movidas` : ""}`);
        void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: board.project.id }));
        void queryClient.invalidateQueries(trpc.sprint.backlog.queryFilter({ projectId: board.project.id }));
        onOpenChange(false);
      },
    }),
  );
  if (!sprint) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Completar {sprint.name}</DialogTitle>
          <DialogDescription>
            {open_ === 0
              ? "Todas las tareas están terminadas."
              : `Quedan ${open_} ${open_ === 1 ? "tarea sin terminar" : "tareas sin terminar"}. ¿Adónde van?`}
          </DialogDescription>
        </DialogHeader>
        {open_ > 0 ? (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={target === "backlog"} onChange={() => setTarget("backlog")} /> Al backlog
            </label>
            {planned.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="radio" checked={target === s.id} onChange={() => setTarget(s.id)} /> A {s.name}
              </label>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={complete.isPending}
            onClick={() =>
              complete.mutate({ sprintId: sprint.id, moveOpenTasksTo: target === "backlog" ? null : target })
            }
          >
            Completar sprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
