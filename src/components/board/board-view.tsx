"use client";

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { useCan, useProject } from "@/components/project/project-context";
import { CreateTaskDialog } from "@/components/task/create-task-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTaskParam } from "@/hooks/use-task-param";
import { rankBetween } from "@/lib/rank";
import { useTRPC } from "@/lib/trpc";
import { BoardColumn } from "./board-column";
import { BoardToolbar } from "./board-toolbar";
import { type Board, type BoardFilters, compareTasks, EMPTY_FILTERS, groupByColumn } from "./filters";
import { SprintBar } from "./sprint-bar";
import { type CardLookups, TaskCardBody } from "./task-card";
import { AiBoardActions } from "@/components/ai/ai-board-actions";

type Columns = Record<string, string[]>;

function useStoredSubtasksToggle(projectId: string): [boolean, (v: boolean) => void] {
  const storageKey = `board:${projectId}:subtasks`;
  const [value, setValue] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  return [
    value,
    (v) => {
      setValue(v);
      try {
        localStorage.setItem(storageKey, v ? "1" : "0");
      } catch {}
    },
  ];
}

/** Aplica optimistamente un movimiento sobre los datos del tablero en caché. */
function applyMoveToBoard(board: Board, taskId: string, columnId: string, afterTaskId: string | null): Board {
  const column = board.columns.find((c) => c.id === columnId);
  const siblings = board.tasks.filter((t) => t.columnId === columnId && t.id !== taskId).sort(compareTasks);
  const index = afterTaskId ? siblings.findIndex((t) => t.id === afterTaskId) : -1;
  const prev = index >= 0 ? siblings[index].rank : null;
  const next = siblings[index + 1]?.rank ?? null;
  let rank: string;
  try {
    rank = rankBetween(prev, next);
  } catch {
    rank = prev ?? next ?? "a0";
  }
  return {
    ...board,
    tasks: board.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            columnId,
            rank,
            completedAt: column?.category === "done" ? (t.completedAt ?? new Date()) : null,
          }
        : t,
    ),
  };
}

export function BoardView() {
  const project = useProject();
  const can = useCan();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { openTask } = useTaskParam();
  const boardKey = trpc.board.get.queryKey({ projectId: project.id });
  const board = useQuery(trpc.board.get.queryOptions({ projectId: project.id }));

  const [showSubtasks, setShowSubtasks] = useStoredSubtasksToggle(project.id);
  const [filterState, setFilterState] = useState<BoardFilters>(EMPTY_FILTERS);
  const filters = useMemo(() => ({ ...filterState, showSubtasks }), [filterState, showSubtasks]);
  const [creating, setCreating] = useState(false);

  const [dragColumns, setDragColumns] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragOrigin = useRef<{ columnId: string; index: number } | null>(null);

  const serverColumns = useMemo(() => (board.data ? groupByColumn(board.data, filters) : {}), [board.data, filters]);
  const columns = dragColumns ?? serverColumns;

  const lookups = useMemo<CardLookups | null>(() => {
    if (!board.data) return null;
    return {
      projectKey: board.data.project.key,
      members: new Map(board.data.members.map((m) => [m.id, m])),
      tags: new Map(board.data.tags.map((t) => [t.id, t])),
      epics: new Map(board.data.epics.map((e) => [e.id, e])),
      tasks: new Map(board.data.tasks.map((t) => [t.id, t])),
    };
  }, [board.data]);

  const move = useMutation(
    trpc.task.move.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: boardKey }),
    }),
  );

  /** Aplica el movimiento en caché de forma síncrona (sin parpadeo) y lo envía al servidor. */
  function commitMove(vars: { taskId: string; columnId: string; afterTaskId: string | null }) {
    void queryClient.cancelQueries({ queryKey: boardKey });
    const previous = queryClient.getQueryData(boardKey);
    if (previous) {
      queryClient.setQueryData(boardKey, applyMoveToBoard(previous, vars.taskId, vars.columnId, vars.afterTaskId));
    }
    move.mutate(vars, {
      onError: () => {
        if (previous) queryClient.setQueryData(boardKey, previous);
      },
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function findColumn(cols: Columns, id: string) {
    if (id in cols) return id;
    return Object.keys(cols).find((columnId) => cols[columnId].includes(id)) ?? null;
  }

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    const columnId = findColumn(serverColumns, id);
    if (!columnId) return;
    dragOrigin.current = { columnId, index: serverColumns[columnId].indexOf(id) };
    setActiveId(id);
    setDragColumns(serverColumns);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setDragColumns((cols) => {
      if (!cols) return cols;
      const activeKey = String(active.id);
      const overKey = String(over.id);
      const from = findColumn(cols, activeKey);
      const to = findColumn(cols, overKey);
      if (!from || !to || from === to) return cols;
      const target = cols[to];
      const overIndex = target.indexOf(overKey);
      const isBelow =
        over.rect && active.rect.current.translated
          ? active.rect.current.translated.top > over.rect.top + over.rect.height / 2
          : false;
      const insertAt = overIndex >= 0 ? overIndex + (isBelow ? 1 : 0) : target.length;
      return {
        ...cols,
        [from]: cols[from].filter((id) => id !== activeKey),
        [to]: [...target.slice(0, insertAt), activeKey, ...target.slice(insertAt)],
      };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    const origin = dragOrigin.current;
    let cols = dragColumns;
    setActiveId(null);
    dragOrigin.current = null;
    if (!cols || !over || !origin) {
      setDragColumns(null);
      return;
    }
    const columnId = findColumn(cols, id);
    const overColumn = findColumn(cols, String(over.id));
    if (columnId && overColumn === columnId) {
      const list = cols[columnId];
      const oldIndex = list.indexOf(id);
      const newIndex = String(over.id) === columnId ? list.length - 1 : list.indexOf(String(over.id));
      if (newIndex >= 0 && oldIndex !== newIndex) cols = { ...cols, [columnId]: arrayMove(list, oldIndex, newIndex) };
    }
    if (!columnId) {
      setDragColumns(null);
      return;
    }
    const finalIndex = cols[columnId].indexOf(id);
    if (columnId !== origin.columnId || finalIndex !== origin.index) {
      const afterTaskId = finalIndex > 0 ? cols[columnId][finalIndex - 1] : null;
      commitMove({ taskId: id, columnId, afterTaskId });
    }
    setDragColumns(null);
  }

  if (board.isLoading || !lookups) {
    return (
      <div className="flex gap-4 p-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-96 w-72 rounded-xl" />
        ))}
      </div>
    );
  }
  if (!board.data) return null;
  const data = board.data;
  const sprintMode = data.project.sprintsEnabled;
  const activeTask = activeId ? lookups.tasks.get(activeId) : null;

  const actions = (
    <>
      <AiBoardActions board={data} />
      {can("task.create") && (!sprintMode || data.activeSprint) ? (
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> Crear
        </Button>
      ) : null}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {sprintMode && data.activeSprint ? <SprintBar board={data} /> : null}
      <BoardToolbar
        board={data}
        filters={filters}
        onChange={(f) => {
          setFilterState(f);
          if (f.showSubtasks !== showSubtasks) setShowSubtasks(f.showSubtasks);
        }}
        actions={actions}
      />
      {sprintMode && !data.activeSprint ? (
        <div className="p-6">
          <EmptyState
            icon={CalendarRange}
            title="No hay un sprint activo"
            description="Con sprints activados, el tablero muestra el sprint en curso. Planificá uno desde el backlog."
            action={
              <Button asChild variant="outline">
                <Link href={`/p/${data.project.key}/backlog`}>Ir al backlog</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setDragColumns(null);
            dragOrigin.current = null;
          }}
        >
          <div className="scrollbar-thin flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-4 pb-4 md:px-6">
            {data.columns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                taskIds={columns[column.id] ?? []}
                lookups={lookups}
                canEdit={can("task.update")}
                canCreate={can("task.create")}
                projectId={data.project.id}
                sprintId={data.activeSprint?.id ?? null}
                onOpen={openTask}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeTask ? <TaskCardBody task={activeTask} lookups={lookups} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}
      <CreateTaskDialog open={creating} onOpenChange={setCreating} board={data} />
    </div>
  );
}
