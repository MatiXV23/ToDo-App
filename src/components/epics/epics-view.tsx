"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { AiSplitAction } from "@/components/ai/ai-task-actions";
import { ColorPicker } from "@/components/common/color-picker";
import { EmptyState } from "@/components/common/empty-state";
import { PriorityIcon } from "@/components/common/priority-icon";
import { useCan, useProject } from "@/components/project/project-context";
import { DescriptionEditor } from "@/components/task/description-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useTaskParam } from "@/hooks/use-task-param";
import { formatHours, PALETTE, taskKey } from "@/lib/domain";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{pct}%</span>
    </div>
  );
}

export function EpicsView() {
  const project = useProject();
  const can = useCan();
  const trpc = useTRPC();
  const epics = useQuery(trpc.epic.list.queryOptions({ projectId: project.id }));
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const open = (epics.data ?? []).filter((e) => e.status === "open");
  const done = (epics.data ?? []).filter((e) => e.status === "done");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Agrupá tareas relacionadas en objetivos más grandes.</p>
        {can("epic.manage") ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Nuevo epic
          </Button>
        ) : null}
      </div>
      {epics.isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : !epics.data?.length ? (
        <EmptyState icon={Layers} title="Sin epics" description="Un epic agrupa tareas que persiguen un mismo objetivo." />
      ) : (
        <div className="space-y-6">
          {[
            { label: "Abiertos", list: open },
            { label: "Terminados", list: done },
          ]
            .filter((g) => g.list.length)
            .map((group) => (
              <section key={group.label}>
                <h2 className="mb-2 text-xs font-medium text-muted-foreground">{group.label}</h2>
                <div className="space-y-2">
                  {group.list.map((epic) => (
                    <button
                      key={epic.id}
                      onClick={() => setOpenId(epic.id)}
                      className="flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors hover:bg-muted/40"
                    >
                      <span className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: epic.color }} />
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate font-medium", epic.status === "done" && "text-muted-foreground")}>{epic.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {epic.done}/{epic.total} tareas
                          {epic.hours ? ` · ${formatHours(epic.hours)} estimadas` : ""}
                        </p>
                      </div>
                      <div className="w-40 shrink-0">
                        <Progress done={epic.done} total={epic.total} />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
      <CreateEpicDialog open={creating} onOpenChange={setCreating} projectId={project.id} />
      <EpicSheet epicId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function CreateEpicDialog({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (v: boolean) => void; projectId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(PALETTE[8]);
  const create = useMutation(
    trpc.epic.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.epic.pathFilter());
        void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId }));
        setTitle("");
        setDescription("");
        onOpenChange(false);
      },
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo epic</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ projectId, title, descriptionMd: description, color });
          }}
        >
          <div className="flex items-center gap-2">
            <ColorPicker value={color} onChange={setColor} />
            <Input autoFocus placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <Textarea
            rows={5}
            placeholder="Descripción en Markdown: objetivo, alcance, criterios…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              Crear epic
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EpicSheet({ epicId, onClose }: { epicId: string | null; onClose: () => void }) {
  const project = useProject();
  const can = useCan();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { openTask } = useTaskParam();
  const epic = useQuery({ ...trpc.epic.get.queryOptions({ epicId: epicId ?? "" }), enabled: !!epicId });
  const board = useQuery(trpc.board.get.queryOptions({ projectId: project.id }));
  const canEdit = can("epic.manage");
  const refresh = () => {
    void queryClient.invalidateQueries(trpc.epic.pathFilter());
    void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: project.id }));
  };
  const update = useMutation(trpc.epic.update.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.epic.delete.mutationOptions({ onSuccess: () => (refresh(), onClose()) }));
  const data = epic.data;
  const columnName = (id: string) => board.data?.columns.find((c) => c.id === id)?.name ?? "";

  return (
    <Sheet open={!!epicId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl" aria-describedby={undefined}>
        <SheetTitle className="sr-only">{data?.title ?? "Epic"}</SheetTitle>
        {!data ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-y-auto">
            <header className="flex items-center gap-2 border-b px-4 py-2.5 pr-12">
              <span className="text-xs font-medium text-muted-foreground">Epic</span>
              <div className="ml-auto flex items-center gap-1">
                {canEdit ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => update.mutate({ epicId: data.id, status: data.status === "open" ? "done" : "open" })}
                  >
                    {data.status === "open" ? "Marcar terminado" : "Reabrir"}
                  </Button>
                ) : null}
                {canEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Más acciones">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() =>
                          window.confirm("¿Borrar el epic? Sus tareas quedan sin epic.") && remove.mutate({ epicId: data.id })
                        }
                      >
                        Borrar epic
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </header>
            <div className="space-y-6 p-6">
              <div className="flex items-center gap-3">
                <ColorPicker value={data.color} disabled={!canEdit} onChange={(color) => update.mutate({ epicId: data.id, color })} />
                <Input
                  key={data.title}
                  defaultValue={data.title}
                  disabled={!canEdit}
                  className="h-10 border-transparent text-lg font-semibold shadow-none hover:bg-muted/50 focus-visible:bg-background disabled:opacity-100"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== data.title) update.mutate({ epicId: data.id, title: v });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              </div>
              <DescriptionEditor
                value={data.descriptionMd}
                disabled={!canEdit}
                onSave={(descriptionMd) => update.mutate({ epicId: data.id, descriptionMd })}
              />
              <section>
                <div className="mb-1.5 flex items-center gap-2">
                  <h3 className="text-xs font-medium text-muted-foreground">Tareas · {data.tasks.length}</h3>
                  <div className="ml-auto">
                    {can("task.create") ? (
                      <AiSplitAction
                        target={{
                          kind: "epic",
                          epic: { id: data.id, title: data.title, descriptionMd: data.descriptionMd, projectId: data.projectId },
                        }}
                      />
                    ) : null}
                  </div>
                </div>
                {data.tasks.length ? (
                  <ul className="divide-y rounded-lg border">
                    {data.tasks.map((t) => (
                      <li key={t.id}>
                        <button
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
                          onClick={() => openTask(taskKey(project.key, t.number))}
                        >
                          <PriorityIcon priority={t.priority} className="size-3.5" />
                          <span className="font-mono text-[11px] text-muted-foreground">{taskKey(project.key, t.number)}</span>
                          <span className={cn("min-w-0 flex-1 truncate", t.completedAt && "text-muted-foreground line-through")}>
                            {t.title}
                          </span>
                          <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{columnName(t.columnId)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Asigná tareas a este epic desde su detalle.</p>
                )}
              </section>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
