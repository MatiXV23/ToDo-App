"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { TaskDetail } from "./types";

/**
 * Tareas que llegaron por un token externo: hasta que alguien las lee y las aprueba,
 * el agente no puede mergear solo su PR.
 */
export function ReviewBanner({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setApproval = useMutation(
    trpc.task.setApproval.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.task.get.queryFilter({ taskId: task.id }));
        void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: task.projectId }));
      },
      onError: (err) => toast.error(err.message),
    }),
  );
  if (!task.reviewStatus) return null;

  // El historial viene del más nuevo al más viejo: el último cambio externo dice de dónde llegó.
  const source = task.activity.find(
    (a) => a.via && ((a.kind === "review" && a.field === "requested") || a.kind === "created"),
  )?.via;
  const origin = source ? `por ${source}` : "por una integración externa";

  if (task.reviewStatus === "approved") {
    const approvedBy = task.activity.find((a) => a.kind === "review" && a.field === "approved")?.userName;
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-green-600" />
        <span className="min-w-0 flex-1">
          Aprobada{approvedBy ? ` por ${approvedBy}` : ""}
          {task.reviewedAt ? ` ${timeAgo(task.reviewedAt)}` : ""} · llegó {origin}
        </span>
        {canEdit ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={setApproval.isPending}
            onClick={() => setApproval.mutate({ taskId: task.id, approved: false })}
          >
            Quitar aprobación
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Pendiente de aprobación</p>
        <p className="text-amber-800">
          Llegó {origin}. Leela antes de aprobarla: una vez aprobada, si Claude la resuelve con un cambio chico, su PR se
          mergea sin revisión.
        </p>
      </div>
      {canEdit ? (
        <Button
          size="xs"
          disabled={setApproval.isPending}
          onClick={() => setApproval.mutate({ taskId: task.id, approved: true })}
        >
          Aprobar
        </Button>
      ) : null}
    </div>
  );
}
