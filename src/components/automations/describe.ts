import type { Board } from "@/components/board/filters";
import { type Action, type Condition, type Trigger } from "@/lib/automation-schema";
import { PRIORITY_META } from "@/lib/domain";

type Lookups = Pick<Board, "columns" | "tags" | "epics" | "members">;

export function lookupNames(board: Lookups) {
  const column = (id?: string | null) => (id ? (board.columns.find((c) => c.id === id)?.name ?? "columna borrada") : "cualquier columna");
  const tag = (id: string) => board.tags.find((t) => t.id === id)?.name ?? "tag borrado";
  const epic = (id: string | null) => (id ? (board.epics.find((e) => e.id === id)?.title ?? "epic borrado") : "ninguno");
  const user = (id: string | null) => (id ? (board.members.find((m) => m.id === id)?.name ?? "ex miembro") : "nadie");
  return { column, tag, epic, user };
}

export function describeTrigger(t: Trigger, board: Lookups) {
  const n = lookupNames(board);
  switch (t.type) {
    case "task.created":
      return "se crea una tarea";
    case "task.moved": {
      const parts = ["una tarea se mueve"];
      if (t.fromColumnId) parts.push(`desde ${n.column(t.fromColumnId)}`);
      if (t.toColumnId) parts.push(`a ${n.column(t.toColumnId)}`);
      return parts.join(" ");
    }
    case "branch.created":
      return "se crea una rama vinculada";
    case "pr.opened":
      return "se abre un PR vinculado";
    case "pr.merged":
      return "se mergea un PR vinculado";
    case "task.due_soon":
      return `faltan ${t.hoursBefore} h para la fecha límite`;
  }
}

export function describeCondition(c: Condition, board: Lookups) {
  const n = lookupNames(board);
  switch (c.type) {
    case "priority":
      return `prioridad ${c.op === "in" ? "es" : "no es"} ${c.values.map((p) => PRIORITY_META[p].label).join(" o ")}`;
    case "tag":
      return `${c.op === "has" ? "tiene" : "no tiene"} el tag ${n.tag(c.tagId)}`;
    case "epic":
      return `epic ${c.op === "is" ? "es" : "no es"} ${n.epic(c.epicId)}`;
    case "assignee":
      return `responsable ${c.op === "is" ? "es" : "no es"} ${n.user(c.userId)}`;
    case "column":
      return `está ${c.op === "is" ? "en" : "fuera de"} ${n.column(c.columnId)}`;
    case "is_subtask":
      return c.value ? "es subtarea" : "es tarea principal";
  }
}

export function describeAction(a: Action, board: Lookups) {
  const n = lookupNames(board);
  switch (a.type) {
    case "move_to_column":
      return `mover a ${n.column(a.columnId)}`;
    case "assign":
      return a.userId ? `asignar a ${n.user(a.userId)}` : "quitar responsable";
    case "add_tag":
      return `agregar el tag ${n.tag(a.tagId)}`;
    case "remove_tag":
      return `quitar el tag ${n.tag(a.tagId)}`;
    case "add_comment":
      return `comentar “${a.body.length > 40 ? `${a.body.slice(0, 40)}…` : a.body}”`;
  }
}
