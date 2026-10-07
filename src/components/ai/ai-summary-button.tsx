"use client";

import { useMutation } from "@tanstack/react-query";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/common/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTRPC } from "@/lib/trpc";
import { AiButton, useAiEnabled } from "./ai-task-actions";

type Scope = { kind: "sprint"; sprintId: string } | { kind: "project"; projectId: string };

export function SummaryDialog({ scope, open, onOpenChange }: { scope: Scope; open: boolean; onOpenChange: (v: boolean) => void }) {
  const trpc = useTRPC();
  const summary = useMutation(trpc.ai.summary.mutationOptions());
  const scopeId = scope.kind === "sprint" ? scope.sprintId : scope.projectId;
  const run = () => summary.mutate(scope.kind === "sprint" ? { sprintId: scope.sprintId } : { projectId: scope.projectId });
  // Se genera al abrir el diálogo.
  useEffect(() => {
    if (open) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Resumen del {scope.kind === "sprint" ? "sprint" : "proyecto"}</DialogTitle>
        </DialogHeader>
        {summary.isPending || !summary.data ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            {summary.isError ? summary.error.message : (
              <>
                <Loader2 className="size-4 animate-spin" /> Analizando las tareas…
              </>
            )}
          </div>
        ) : (
          <Markdown>{summary.data}</Markdown>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" onClick={run} disabled={summary.isPending}>
            <RefreshCw /> Regenerar
          </Button>
          <Button
            variant="outline"
            disabled={!summary.data}
            onClick={async () => {
              await navigator.clipboard.writeText(summary.data ?? "");
              toast.success("Resumen copiado");
            }}
          >
            <Copy /> Copiar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Resumen con IA de un sprint o proyecto (solo lectura de datos). */
export function AiSummaryButton({ scope }: { scope: Scope }) {
  const enabled = useAiEnabled("ai.summarize");
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return (
    <>
      <AiButton onClick={() => setOpen(true)} pending={false}>
        Resumir
      </AiButton>
      <SummaryDialog scope={scope} open={open} onOpenChange={setOpen} />
    </>
  );
}

