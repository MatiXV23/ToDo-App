"use client";

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, GripVertical, MoreHorizontal, Play, Plus, Target } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AiSummaryButton } from "@/components/ai/ai-summary-button";
import { EpicChip } from "@/components/common/chips";
import { EmptyState } from "@/components/common/empty-state";
import { PriorityIcon } from "@/components/common/priority-icon";
import { UserAvatar } from "@/components/common/user-avatar";
import { CompleteSprintDialog } from "@/components/board/sprint-bar";
import { useCan, useProject } from "@/components/project/project-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useTaskParam } from "@/hooks/use-task-param";
import { formatHours, taskKey } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { rankBetween } from "@/lib/rank";
import { type RouterOutputs, useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Backlog = RouterOutputs["sprint"]["backlog"];
type Sprint = Backlog["sprints"][number];
type Row = Backlog["tasks"][number];
const BACKLOG = "backlog";
type Sections = Record<string, string[]>;

function groupSections(data: Backlog): Sections {
  const out: Sections = { [BACKLOG]: [] };
  for (const s of data.sprints) out[s.id] = [];
  for (const t of data.tasks) (out[t.sprintId ?? BACKLOG] ??= []).push(t.id);
  return out;
}

export function BacklogView() {
  const project = useProject();
  const can = useCan();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { openTask } = useTaskParam();
  const backlogKey = trpc.sprint.backlog.queryKey({ projectId: project.id });
  const backlog = useQuery({ ...trpc.sprint.backlog.queryOptions({ projectId: project.id }), enabled: project.sprintsEnabled });
  const board = useQuery(trpc.board.get.queryOptions({ projectId: project.id }));
  const [drag, setDrag] = useState<Sections | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const origin = useRef<{ section: string; index: number } | null>(null);
  const [sprintDialog, setSprintDialog] = useState<SprintDialogState | null>(null);
  const openSprintDialog = (mode: SprintDialogState["mode"], sprint?: Sprint) => setSprintDialog(sprintDialogState(mode, sprint));
  const [completing, setCompleting] = useState(false);
  const canManage = can("sprint.manage");

  const sections = useMemo(() => (backlog.data ? groupSections(backlog.data) : {}), [backlog.data]);
  const current = drag ?? sections;
  const rows = useMemo(() => new Map((backlog.data?.tasks ?? []).map((t) => [t.id, t])), [backlog.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: backlogKey });
    void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: project.id }));
  };
  const move = useMutation(trpc.sprint.moveTask.mutationOptions({ onSettled: refresh }));

  /** Reordena en caché de forma síncrona y envía el cambio al servidor. */
  function commitMove(vars: { taskId: string; sprintId: string | null; afterTaskId: string | null }) {
    void queryClient.cancelQueries({ queryKey: backlogKey });
    const previous = queryClient.getQueryData(backlogKey);
    if (previous) {
      const siblings = previous.tasks
        .filter((t) => (t.sprintId ?? null) === vars.sprintId && t.id !== vars.taskId)
        .sort((a, b) => (a.backlogRank < b.backlogRank ? -1 : 1));
      const i = vars.afterTaskId ? siblings.findIndex((t) => t.id === vars.afterTaskId) : -1;
      let rank: string;
      try {
        rank = rankBetween(i >= 0 ? siblings[i].backlogRank : null, siblings[i + 1]?.backlogRank ?? null);
      } catch {
        rank = siblings[i]?.backlogRank ?? "a0";
      }
      queryClient.setQueryData(backlogKey, {
        ...previous,
        tasks: previous.tasks
          .map((t) => (t.id === vars.taskId ? { ...t, sprintId: vars.sprintId, backlogRank: rank } : t))
          .sort((a, b) => (a.backlogRank < b.backlogRank ? -1 : a.backlogRank > b.backlogRank ? 1 : 0)),
      });
    }
    move.mutate(vars, { onError: () => previous && queryClient.setQueryData(backlogKey, previous) });
  }
  const create = useMutation(trpc.task.create.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.sprint.delete.mutationOptions({ onSuccess: refresh }));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const find = (s: Sections, id: string) => (id in s ? id : (Object.keys(s).find((k) => s[k].includes(id)) ?? null));

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setDrag((s) => {
      if (!s) return s;
      const a = String(active.id);
      const from = find(s, a);
      const to = find(s, String(over.id));
      if (!from || !to || from === to) return s;
      const idx = s[to].indexOf(String(over.id));
      const at = idx >= 0 ? idx : s[to].length;
      return { ...s, [from]: s[from].filter((x) => x !== a), [to]: [...s[to].slice(0, at), a, ...s[to].slice(at)] };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    let s = drag;
    const start = origin.current;
    setActiveId(null);
    origin.current = null;
    setDrag(null);
    if (!s || !over || !start) return;
    const section = find(s, id);
    if (!section) return;
    // setDrag(null) se aplica en el mismo render que el cambio optimista de abajo.
    if (find(s, String(over.id)) === section && String(over.id) !== section) {
      const list = s[section];
      s = { ...s, [section]: arrayMove(list, list.indexOf(id), list.indexOf(String(over.id))) };
    }
    const index = s[section].indexOf(id);
    if (section === start.section && index === start.index) return;
    commitMove({ taskId: id, sprintId: section === BACKLOG ? null : section, afterTaskId: index > 0 ? s[section][index - 1] : null });
  }

  if (!project.sprintsEnabled) {
    return (
      <div className="p-6">
        <EmptyState
          icon={CalendarRange}
          title="Los sprints están desactivados"
          description="Activalos en Ajustes para planificar con backlog y sprints."
          action={
            <Button asChild variant="outline">
              <Link href={`/p/${project.key}/settings`}>Ir a ajustes</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (!backlog.data || !board.data) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const data = backlog.data;
  const lookups = {
    members: new Map(board.data.members.map((m) => [m.id, m])),
    epics: new Map(board.data.epics.map((e) => [e.id, e])),
  };
  const hasActive = data.sprints.some((s) => s.status === "active");
  const activeRow = activeId ? rows.get(activeId) : null;

  const renderSection = (id: string, header: React.ReactNode) => (
    <SectionList
      key={id}
      id={id}
      header={header}
      ids={current[id] ?? []}
      rows={rows}
      lookups={lookups}
      projectKey={project.key}
      disabled={!canManage}
      onOpen={openTask}
    />
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-6">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={({ active }) => {
          const id = String(active.id);
          const section = find(sections, id);
          if (!section) return;
          origin.current = { section, index: sections[section].indexOf(id) };
          setActiveId(id);
          setDrag(sections);
        }}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDrag(null);
          setActiveId(null);
        }}
      >
        {data.sprints.map((sprint) => {
          const ids = current[sprint.id] ?? [];
          const hours = ids.reduce((sum, id) => sum + (rows.get(id)?.estimateHours ?? 0), 0);
          return renderSection(
            sprint.id,
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold">{sprint.name}</h2>
              {sprint.status === "active" ? (
                <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">Activo</span>
              ) : null}
              {sprint.startDate || sprint.endDate ? (
                <span className="text-xs text-muted-foreground">
                  {sprint.startDate ? formatDate(sprint.startDate) : "?"} – {sprint.endDate ? formatDate(sprint.endDate) : "?"}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {ids.length} tareas{hours ? ` · ${formatHours(hours)}` : ""}
              </span>
              {sprint.goal ? (
                <span className="flex w-full items-center gap-1 text-xs text-muted-foreground">
                  <Target className="size-3" /> {sprint.goal}
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-1">
                <AiSummaryButton scope={{ kind: "sprint", sprintId: sprint.id }} />
                {canManage && sprint.status === "planned" ? (
                  <Button size="xs" variant="outline" disabled={hasActive} onClick={() => openSprintDialog("start", sprint)}>
                    <Play /> Iniciar
                  </Button>
                ) : null}
                {canManage && sprint.status === "active" ? (
                  <Button size="xs" variant="outline" onClick={() => setCompleting(true)}>
                    Completar
                  </Button>
                ) : null}
                {canManage ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label="Opciones del sprint">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => openSprintDialog("edit", sprint)}>Editar</DropdownMenuItem>
                      {sprint.status === "planned" ? (
                        <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate({ sprintId: sprint.id })}>
                          Borrar (las tareas vuelven al backlog)
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>,
          );
        })}
        {renderSection(
          BACKLOG,
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">Backlog</h2>
            <span className="text-xs text-muted-foreground">{(current[BACKLOG] ?? []).length} tareas</span>
            {canManage ? (
              <Button size="xs" variant="outline" className="ml-auto" onClick={() => openSprintDialog("create")}>
                <Plus /> Crear sprint
              </Button>
            ) : null}
          </div>,
        )}
        <DragOverlay dropAnimation={null}>
          {activeRow ? (
            <TaskRow row={activeRow} lookups={lookups} projectKey={project.key} overlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      {can("task.create") ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("title") as HTMLInputElement;
            if (!input.value.trim()) return;
            create.mutate({ projectId: project.id, title: input.value.trim(), sprintId: null });
            input.value = "";
          }}
        >
          <Plus className="size-4 text-muted-foreground" />
          <Input name="title" placeholder="Agregar tarea al backlog" className="h-8" />
        </form>
      ) : null}

      {sprintDialog ? (
        <SprintDialog key={sprintDialog.key} state={sprintDialog} onClose={() => setSprintDialog(null)} projectId={project.id} onDone={refresh} />
      ) : null}
      <CompleteSprintDialog
        board={{
          project: board.data.project,
          activeSprint: board.data.activeSprint,
          sprints: board.data.sprints,
          tasks: board.data.tasks,
        }}
        open={completing}
        onOpenChange={setCompleting}
      />
    </div>
  );
}

type RowLookups = { members: Map<string, { name: string; image: string | null }>; epics: Map<string, { title: string; color: string }> };

function SectionList({
  id,
  header,
  ids,
  rows,
  lookups,
  projectKey,
  disabled,
  onOpen,
}: {
  id: string;
  header: React.ReactNode;
  ids: string[];
  rows: Map<string, Row>;
  lookups: RowLookups;
  projectKey: string;
  disabled: boolean;
  onOpen: (key: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section className="rounded-xl border">
      <div className="border-b bg-muted/30 px-4 py-2.5">{header}</div>
      <div ref={setNodeRef} className={cn("min-h-12 divide-y transition-colors", isOver && "bg-muted/50")}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((taskId) => {
            const row = rows.get(taskId);
            return row ? (
              <SortableRow key={taskId} row={row} lookups={lookups} projectKey={projectKey} disabled={disabled} onOpen={onOpen} />
            ) : null;
          })}
        </SortableContext>
        {ids.length === 0 ? <p className="px-4 py-3 text-xs text-muted-foreground">Arrastrá tareas acá.</p> : null}
      </div>
    </section>
  );
}

function SortableRow({
  row,
  lookups,
  projectKey,
  disabled,
  onOpen,
}: {
  row: Row;
  lookups: RowLookups;
  projectKey: string;
  disabled: boolean;
  onOpen: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(taskKey(projectKey, row.number))}
    >
      <TaskRow row={row} lookups={lookups} projectKey={projectKey} />
    </div>
  );
}

function TaskRow({ row, lookups, projectKey, overlay }: { row: Row; lookups: RowLookups; projectKey: string; overlay?: boolean }) {
  const epic = row.epicId ? lookups.epics.get(row.epicId) : null;
  const assignee = row.assigneeId ? lookups.members.get(row.assigneeId) : null;
  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-2 bg-background px-3 py-2 text-sm hover:bg-muted/40",
        overlay && "rounded-lg border shadow-lg",
      )}
    >
      <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40" />
      <PriorityIcon priority={row.priority} className="size-3.5" />
      <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{taskKey(projectKey, row.number)}</span>
      <span className={cn("min-w-0 flex-1 truncate", row.completedAt && "text-muted-foreground line-through")}>{row.title}</span>
      {row.subtaskCount ? <span className="text-[11px] text-muted-foreground">{row.subtaskCount} sub</span> : null}
      {epic ? <EpicChip epic={epic} className="hidden sm:inline-flex" /> : null}
      <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{formatHours(row.estimateHours)}</span>
      <span className="w-5">{assignee ? <UserAvatar user={assignee} className="size-5" /> : null}</span>
    </div>
  );
}

type SprintForm = { name: string; goal: string; startDate: string; endDate: string };
type SprintDialogState = { mode: "create" | "edit" | "start"; sprint?: Sprint; key: string; initial: SprintForm };

let dialogSeq = 0;

/** Estado inicial del diálogo; las fechas por defecto se calculan al abrirlo. */
function sprintDialogState(mode: SprintDialogState["mode"], sprint?: Sprint): SprintDialogState {
  const today = new Date().toISOString().slice(0, 10);
  const inTwoWeeks = new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10);
  return {
    mode,
    sprint,
    key: `${mode}:${sprint?.id ?? "new"}:${++dialogSeq}`,
    initial: {
      name: sprint?.name ?? "",
      goal: sprint?.goal ?? "",
      startDate: sprint?.startDate ?? (mode === "start" ? today : ""),
      endDate: sprint?.endDate ?? (mode === "start" ? inTwoWeeks : ""),
    },
  };
}

function SprintDialog({
  state,
  onClose,
  projectId,
  onDone,
}: {
  state: SprintDialogState;
  onClose: () => void;
  projectId: string;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const sprint = state.sprint;
  const [form, setForm] = useState<SprintForm>(state.initial);
  const done = () => {
    onDone();
    onClose();
  };
  const create = useMutation(trpc.sprint.create.mutationOptions({ onSuccess: done }));
  const update = useMutation(trpc.sprint.update.mutationOptions({ onSuccess: done }));
  const start = useMutation(
    trpc.sprint.start.mutationOptions({
      onSuccess: () => {
        toast.success("Sprint iniciado");
        done();
      },
    }),
  );

  const submit = async () => {
    const dates = { startDate: form.startDate || null, endDate: form.endDate || null };
    if (state.mode === "create") create.mutate({ projectId, name: form.name || undefined, goal: form.goal, ...dates });
    else if (sprint && state.mode === "edit") update.mutate({ sprintId: sprint.id, name: form.name || sprint.name, goal: form.goal, ...dates });
    else if (sprint && state.mode === "start") {
      await update.mutateAsync({ sprintId: sprint.id, name: form.name || sprint.name, goal: form.goal });
      start.mutate({ sprintId: sprint.id, ...dates });
    }
  };

  const title = state.mode === "create" ? "Nuevo sprint" : state.mode === "start" ? `Iniciar ${sprint?.name}` : "Editar sprint";
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sprint-name">Nombre</Label>
            <Input
              id="sprint-name"
              value={form.name}
              placeholder="Sprint N"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sprint-goal">Objetivo</Label>
            <Textarea id="sprint-goal" rows={2} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sprint-start">Inicio</Label>
              <Input id="sprint-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sprint-end">Fin</Label>
              <Input id="sprint-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={create.isPending || update.isPending || start.isPending}>
            {state.mode === "start" ? "Iniciar sprint" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
