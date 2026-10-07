"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Board } from "@/components/board/filters";
import { AssigneeField, DateField, PriorityField } from "@/components/task/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Priority } from "@/lib/domain";
import { useTRPC } from "@/lib/trpc";
import { useAiEnabled } from "./ai-task-actions";
import { SummaryDialog } from "./ai-summary-button";

type Draft = {
  title: string;
  descriptionMd: string;
  dueDate: string | null;
  priority: Priority;
  assigneeId: string | null;
  tagIds: string[];
  selected: boolean;
};

export function AiBoardActions({ board }: { board: Board }) {
  const canUse = useAiEnabled("ai.use");
  const canSummarize = useAiEnabled("ai.summarize");
  const [fromText, setFromText] = useState(false);
  const [summary, setSummary] = useState(false);
  if (!canUse && !canSummarize) return null;
  const sprintMode = board.project.sprintsEnabled && board.activeSprint;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="text-brand">
            <Sparkles /> IA <ChevronDown className="opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {canUse && (!board.project.sprintsEnabled || board.activeSprint) ? (
            <DropdownMenuItem onSelect={() => setFromText(true)}>Crear tareas desde texto</DropdownMenuItem>
          ) : null}
          {canSummarize ? (
            <DropdownMenuItem onSelect={() => setSummary(true)}>
              {sprintMode ? "Resumir el sprint" : "Resumir el proyecto"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <FromTextDialog board={board} open={fromText} onOpenChange={setFromText} />
      <SummaryDialog
        open={summary}
        onOpenChange={setSummary}
        scope={sprintMode ? { kind: "sprint", sprintId: board.activeSprint!.id } : { kind: "project", projectId: board.project.id }}
      />
    </>
  );
}

function FromTextDialog({ board, open, onOpenChange }: { board: Board; open: boolean; onOpenChange: (v: boolean) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [creating, setCreating] = useState(false);
  const lookups = { ...board, projectId: board.project.id };
  const parse = useMutation(
    trpc.ai.parseTasks.mutationOptions({ onSuccess: (list) => setDrafts(list.map((t) => ({ ...t, selected: true }))) }),
  );
  const create = useMutation(trpc.task.create.mutationOptions());
  const selected = (drafts ?? []).filter((d) => d.selected && d.title.trim());
  const update = (i: number, patch: Partial<Draft>) => setDrafts((list) => list?.map((d, j) => (j === i ? { ...d, ...patch } : d)) ?? null);

  async function apply() {
    setCreating(true);
    try {
      for (const d of selected) {
        await create.mutateAsync({
          projectId: board.project.id,
          title: d.title.trim(),
          descriptionMd: d.descriptionMd,
          dueDate: d.dueDate,
          priority: d.priority,
          assigneeId: d.assigneeId,
          tagIds: d.tagIds,
          sprintId: board.activeSprint?.id ?? null,
        });
      }
      toast.success(`${selected.length} ${selected.length === 1 ? "tarea creada" : "tareas creadas"}`);
      void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: board.project.id }));
      setText("");
      setDrafts(null);
      onOpenChange(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crear tareas desde texto</DialogTitle>
          <DialogDescription>Escribí como lo dirías. Revisás las tareas antes de crearlas.</DialogDescription>
        </DialogHeader>
        {drafts === null ? (
          <Textarea
            autoFocus
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="mañana tengo que revisar el deploy y avisarle a Juan"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length >= 3) {
                parse.mutate({ projectId: board.project.id, text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
              }
            }}
          />
        ) : (
          <ul className="space-y-2">
            {drafts.map((d, i) => (
              <li key={i} className="group/field space-y-1 rounded-lg border p-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={d.selected} onChange={(e) => update(i, { selected: e.target.checked })} />
                  <Input value={d.title} onChange={(e) => update(i, { title: e.target.value })} className="h-8" />
                </div>
                <div className="grid grid-cols-1 gap-1 pl-6 sm:grid-cols-3">
                  <AssigneeField board={lookups} value={d.assigneeId} onChange={(assigneeId) => update(i, { assigneeId })} />
                  <PriorityField value={d.priority} onChange={(priority) => update(i, { priority })} />
                  <DateField value={d.dueDate} onChange={(dueDate) => update(i, { dueDate })} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter className="sm:justify-between">
          {drafts !== null ? (
            <Button variant="ghost" size="sm" onClick={() => setDrafts(null)}>
              Editar el texto
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {drafts === null ? (
              <Button
                disabled={text.trim().length < 3 || parse.isPending}
                onClick={() => parse.mutate({ projectId: board.project.id, text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
              >
                {parse.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Proponer tareas
              </Button>
            ) : (
              <Button onClick={apply} disabled={!selected.length || creating}>
                {creating ? <Loader2 className="animate-spin" /> : null}
                Crear {selected.length} {selected.length === 1 ? "tarea" : "tareas"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
