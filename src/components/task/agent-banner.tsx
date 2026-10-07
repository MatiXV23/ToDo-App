"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { TaskDetail } from "./types";

export const AGENT_STATUS: Record<string, { label: string; className: string }> = {
  claimed: { label: "Claude está trabajando en esta tarea", className: "border-brand/30 bg-brand/5 text-brand" },
  pr_open: { label: "Claude abrió un PR para esta tarea", className: "border-amber-300 bg-amber-50 text-amber-800" },
  merged: { label: "El PR de Claude se mergeó", className: "border-purple-200 bg-purple-50 text-purple-700" },
  blocked: { label: "Claude necesita una respuesta para seguir", className: "border-red-200 bg-red-50 text-red-700" },
};

/** Estado del agente Claude sobre la tarea, con la opción de devolverla a la cola. */
export function AgentBanner({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const requeue = useMutation(
    trpc.agent.requeue.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.task.get.queryFilter({ taskId: task.id }));
        void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: task.projectId }));
      },
    }),
  );
  const meta = task.agentStatus ? AGENT_STATUS[task.agentStatus] : null;
  if (!meta) return null;
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", meta.className)}>
      <Bot className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {meta.label}
        {task.agentBranch ? (
          <>
            {" "}
            · <span className="font-mono text-xs">{task.agentBranch}</span>
          </>
        ) : null}
      </span>
      {canEdit && (task.agentStatus === "blocked" || task.agentStatus === "claimed") ? (
        <Button size="xs" variant="outline" disabled={requeue.isPending} onClick={() => requeue.mutate({ taskId: task.id })}>
          Volver a la cola
        </Button>
      ) : null}
    </div>
  );
}
