"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Board } from "@/components/board/filters";
import { TagChip } from "@/components/common/chips";
import { Markdown } from "@/components/common/markdown";
import { PriorityIcon } from "@/components/common/priority-icon";
import { useCan } from "@/components/project/project-context";
import type { TaskDetail } from "@/components/task/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatHours, PALETTE, type Priority, PRIORITY_META } from "@/lib/domain";
import { useTRPC } from "@/lib/trpc";

export function useAiEnabled(action: "ai.use" | "ai.summarize" = "ai.use") {
  const trpc = useTRPC();
  const can = useCan();
  const status = useQuery({ ...trpc.ai.status.queryOptions(), staleTime: 5 * 60_000 });
  return !!status.data?.configured && can(action);
}

export function AiButton({ children, pending, ...props }: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button size="xs" variant="ghost" className="text-brand hover:text-brand" disabled={pending || props.disabled} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {children}
    </Button>
  );
}

// ─── Descripción ────────────────────────────────────────────────────────

export function AiDescriptionActions({ task, onApply }: { task: TaskDetail; onApply: (description: string) => void }) {
  const trpc = useTRPC();
  const enabled = useAiEnabled();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const improving = !!task.descriptionMd.trim();
  const generate = useMutation(trpc.ai.description.mutationOptions({ onSuccess: (text) => (setDraft(text), setEditing(false)) }));
  if (!enabled) return null;

  const run = () =>
    generate.mutate({
      projectId: task.projectId,
      title: task.title,
      note: improving ? undefined : note,
      current: improving ? task.descriptionMd : undefined,
    });

  return (
    <>
      <AiButton
        onClick={() => {
          setOpen(true);
          setDraft(null);
          if (improving) run();
        }}
      >
        {improving ? "Mejorar" : "Redactar"}
      </AiButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{improving ? "Mejorar la descripción" : "Redactar la descripción"}</DialogTitle>
            <DialogDescription>Es una sugerencia: revisala y editala antes de usarla.</DialogDescription>
          </DialogHeader>
          {!improving && draft === null ? (
            <div className="space-y-2">
              <Textarea
                autoFocus
                rows={4}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Contale en pocas palabras qué hay que hacer (opcional)"
              />
            </div>
          ) : null}
          {generate.isPending ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Pensando…
            </div>
          ) : draft !== null ? (
            editing ? (
              <Textarea rows={14} value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-[13px]" />
            ) : (
              <div className="rounded-lg border p-4">
                <Markdown>{draft}</Markdown>
              </div>
            )
          ) : null}
          <DialogFooter className="sm:justify-between">
            <div className="flex gap-2">
              {draft !== null ? (
                <>
                  <Button variant="ghost" size="sm" onClick={run} disabled={generate.isPending}>
                    <RefreshCw /> Otra versión
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
                    {editing ? "Vista previa" : "Editar"}
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Descartar
              </Button>
              {draft === null ? (
                <Button onClick={run} disabled={generate.isPending || improving}>
                  <Sparkles /> Generar
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    onApply(draft);
                    setOpen(false);
                    toast.success("Descripción actualizada");
                  }}
                >
                  Usar esta descripción
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Dividir en subtareas o tareas ──────────────────────────────────────

export type SplitTarget =
  | { kind: "task"; task: TaskDetail }
  | { kind: "epic"; epic: { id: string; title: string; descriptionMd: string; projectId: string } };

type SplitItem = { title: string; description: string; estimateHours: number | null; selected: boolean };

export function AiSplitAction({ target }: { target: SplitTarget }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const enabled = useAiEnabled();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SplitItem[]>([]);
  const [creating, setCreating] = useState(false);
  const generate = useMutation(
    trpc.ai.split.mutationOptions({
      onSuccess: (list) =>
        setItems(list.map((s) => ({ title: s.title, description: s.description ?? "", estimateHours: s.estimateHours ?? null, selected: true }))),
    }),
  );
  const create = useMutation(trpc.task.create.mutationOptions());
  if (!enabled) return null;

  const projectId = target.kind === "task" ? target.task.projectId : target.epic.projectId;
  const run = () => generate.mutate(target.kind === "task" ? { taskId: target.task.id } : { epicId: target.epic.id });
  const selected = items.filter((i) => i.selected && i.title.trim());
  const label = target.kind === "task" ? "subtareas" : "tareas";

  async function apply() {
    setCreating(true);
    try {
      for (const item of selected) {
        await create.mutateAsync({
          projectId,
          title: item.title.trim(),
          descriptionMd: item.description,
          estimateHours: item.estimateHours,
          ...(target.kind === "task"
            ? { parentId: target.task.id }
            : { epicId: target.epic.id }),
        });
      }
      toast.success(`${selected.length} ${label} creadas`);
      void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId }));
      void queryClient.invalidateQueries(trpc.task.pathFilter());
      void queryClient.invalidateQueries(trpc.epic.pathFilter());
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <AiButton
        onClick={() => {
          setOpen(true);
          setItems([]);
          run();
        }}
      >
        Dividir
      </AiButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{target.kind === "task" ? "Dividir en subtareas" : "Dividir el epic en tareas"}</DialogTitle>
            <DialogDescription>Elegí cuáles crear y ajustá títulos o estimaciones.</DialogDescription>
          </DialogHeader>
          {generate.isPending ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Pensando…
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border p-2">
                  <input
                    type="checkbox"
                    className="mt-2"
                    checked={item.selected}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <Input
                      value={item.title}
                      onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                      className="h-8"
                    />
                    {item.description ? <p className="px-1 text-xs text-muted-foreground">{item.description}</p> : null}
                  </div>
                  <div className="relative w-20 shrink-0">
                    <Input
                      inputMode="decimal"
                      value={item.estimateHours ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        setItems(
                          items.map((x, j) =>
                            j === i ? { ...x, estimateHours: e.target.value ? Number(e.target.value.replace(",", ".")) || null : null } : x,
                          ),
                        )
                      }
                      className="h-8 pr-6"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">h</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" size="sm" onClick={run} disabled={generate.isPending}>
              <RefreshCw /> Otra propuesta
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Descartar
              </Button>
              <Button onClick={apply} disabled={!selected.length || creating || generate.isPending}>
                {creating ? <Loader2 className="animate-spin" /> : null}
                Crear {selected.length} {label}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Prioridad, estimación y tags ───────────────────────────────────────

export function AiSuggestFieldsAction({
  task,
  board,
  onApply,
}: {
  task: TaskDetail;
  board: Board;
  onApply: (patch: { priority?: Priority; estimateHours?: number | null; tagIds?: string[] }) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const enabled = useAiEnabled();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState({ priority: true, hours: true, tags: true, newTags: true });
  const suggest = useMutation(trpc.ai.fields.mutationOptions());
  const createTag = useMutation(trpc.tag.create.mutationOptions());
  if (!enabled) return null;
  const s = suggest.data;

  async function apply() {
    if (!s) return;
    const patch: { priority?: Priority; estimateHours?: number | null; tagIds?: string[] } = {};
    if (pick.priority) patch.priority = s.priority;
    if (pick.hours && s.estimateHours !== null) patch.estimateHours = s.estimateHours;
    if (pick.tags || pick.newTags) {
      const ids = new Set(task.tags.map((t) => t.id));
      if (pick.tags) s.tagIds.forEach((id) => ids.add(id));
      if (pick.newTags && can("tag.manage")) {
        for (const [i, name] of s.newTags.entries()) {
          const tag = await createTag.mutateAsync({ projectId: task.projectId, name, color: PALETTE[(board.tags.length + i) % PALETTE.length] });
          ids.add(tag.id);
        }
        void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: task.projectId }));
      }
      patch.tagIds = [...ids];
    }
    onApply(patch);
    setOpen(false);
    toast.success("Sugerencias aplicadas");
  }

  const row = (key: keyof typeof pick, label: string, value: React.ReactNode) => (
    <label className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
      <input type="checkbox" checked={pick[key]} onChange={(e) => setPick({ ...pick, [key]: e.target.checked })} />
      <span className="w-24 text-xs text-muted-foreground">{label}</span>
      <span className="flex flex-wrap items-center gap-1">{value}</span>
    </label>
  );

  return (
    <>
      <AiButton
        className="w-full justify-start text-brand"
        onClick={() => {
          setOpen(true);
          suggest.mutate({ taskId: task.id });
        }}
      >
        Sugerir prioridad, estimación y tags
      </AiButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sugerencias para {task.key}</DialogTitle>
            <DialogDescription>Elegí qué aplicar.</DialogDescription>
          </DialogHeader>
          {suggest.isPending || !s ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Pensando…
            </div>
          ) : (
            <div className="space-y-2">
              {row(
                "priority",
                "Prioridad",
                <>
                  <PriorityIcon priority={s.priority} /> {PRIORITY_META[s.priority].label}
                </>,
              )}
              {s.estimateHours !== null ? row("hours", "Estimación", formatHours(s.estimateHours)) : null}
              {s.tagIds.length
                ? row(
                    "tags",
                    "Tags",
                    board.tags.filter((t) => s.tagIds.includes(t.id)).map((t) => <TagChip key={t.id} tag={t} />),
                  )
                : null}
              {s.newTags.length && can("tag.manage")
                ? row(
                    "newTags",
                    "Tags nuevos",
                    s.newTags.map((name) => <TagChip key={name} tag={{ name, color: "#64748b" }} />),
                  )
                : null}
              {s.reasoning ? <p className="pt-1 text-xs text-muted-foreground">{s.reasoning}</p> : null}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Descartar
            </Button>
            <Button onClick={apply} disabled={!s || suggest.isPending}>
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
