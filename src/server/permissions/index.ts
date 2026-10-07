/**
 * Matriz de permisos por rol. Es la única fuente de verdad: los services la consultan
 * antes de leer o escribir, y la UI la usa solo para ocultar lo que no se puede hacer.
 */
export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

const ALL: readonly Role[] = ["owner", "editor", "viewer"];
const WRITERS: readonly Role[] = ["owner", "editor"];
const OWNER: readonly Role[] = ["owner"];

export const PERMISSIONS = {
  "project.view": ALL,
  "project.update": OWNER,
  "project.archive": OWNER,
  "project.delete": OWNER,
  "member.manage": OWNER,

  "task.create": WRITERS,
  "task.update": WRITERS,
  "task.delete": WRITERS,
  "comment.create": WRITERS,
  /** Editar o borrar comentarios ajenos. */
  "comment.moderate": OWNER,

  "column.manage": WRITERS,
  "epic.manage": WRITERS,
  "tag.manage": WRITERS,
  "sprint.manage": WRITERS,

  "automation.view": ALL,
  "automation.manage": WRITERS,

  /** Conectar o desconectar repositorios del proyecto. */
  "repo.connect": OWNER,
  /** Crear ramas desde tareas y vincular o desvincular ramas, commits y PRs. */
  "repo.link": WRITERS,

  "ai.use": WRITERS,
  "ai.summarize": ALL,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return (PERMISSIONS[action] as readonly Role[]).includes(role);
}

/** Lista de acciones permitidas para un rol; se envía al cliente para adaptar la UI. */
export function allowedActions(role: Role | null | undefined): Action[] {
  return (Object.keys(PERMISSIONS) as Action[]).filter((a) => can(role, a));
}

export { ROLE_LABELS } from "./labels";
