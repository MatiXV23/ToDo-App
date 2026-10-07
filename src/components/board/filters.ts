import type { Priority } from "@/lib/domain";
import { slugify, taskKey } from "@/lib/domain";
import type { RouterOutputs } from "@/lib/trpc";

export type Board = RouterOutputs["board"]["get"];
export type BoardTask = Board["tasks"][number];

export type BoardFilters = {
  q: string;
  /** Ids de usuario; "none" = sin responsable. */
  assignees: string[];
  /** Ids de epic; "none" = sin epic. */
  epics: string[];
  tags: string[];
  priorities: Priority[];
  showSubtasks: boolean;
};

export const EMPTY_FILTERS: BoardFilters = {
  q: "",
  assignees: [],
  epics: [],
  tags: [],
  priorities: [],
  showSubtasks: false,
};

export function activeFilterCount(f: BoardFilters) {
  return (f.q ? 1 : 0) + f.assignees.length + f.epics.length + f.tags.length + f.priorities.length;
}

const normalize = (s: string) => slugify(s).replace(/-/g, " ");

export function matchesFilters(task: BoardTask, f: BoardFilters, projectKey: string) {
  if (!f.showSubtasks && task.parentId) return false;
  if (f.q) {
    const q = normalize(f.q);
    const key = taskKey(projectKey, task.number).toLowerCase();
    if (!normalize(task.title).includes(q) && !key.includes(f.q.trim().toLowerCase())) return false;
  }
  if (f.assignees.length && !f.assignees.includes(task.assigneeId ?? "none")) return false;
  if (f.epics.length && !f.epics.includes(task.epicId ?? "none")) return false;
  if (f.tags.length && !task.tagIds.some((t) => f.tags.includes(t))) return false;
  if (f.priorities.length && !f.priorities.includes(task.priority)) return false;
  return true;
}

export function compareTasks(a: { rank: string; id: string }, b: { rank: string; id: string }) {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ids de tareas visibles por columna, en orden. */
export function groupByColumn(board: Board, f: BoardFilters): Record<string, string[]> {
  const out: Record<string, string[]> = Object.fromEntries(board.columns.map((c) => [c.id, []]));
  const sorted = [...board.tasks].sort(compareTasks);
  for (const task of sorted) {
    if (out[task.columnId] && matchesFilters(task, f, board.project.key)) out[task.columnId].push(task.id);
  }
  return out;
}
