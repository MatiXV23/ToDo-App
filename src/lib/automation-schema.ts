import * as z from "zod";
import { PRIORITIES } from "./domain";

/**
 * Esquema de las reglas "cuando ocurre X, si se cumple Y, hacer Z".
 * Vive en lib/ porque lo usan el servidor (validación y motor) y el editor de reglas.
 */

export const TRIGGER_TYPES = [
  "task.created",
  "task.moved",
  "branch.created",
  "pr.opened",
  "pr.merged",
  "task.due_soon",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  "task.created": "Se crea una tarea",
  "task.moved": "Una tarea cambia de columna",
  "branch.created": "Se crea una rama vinculada",
  "pr.opened": "Se abre un PR vinculado",
  "pr.merged": "Se mergea un PR vinculado",
  "task.due_soon": "Se acerca la fecha límite",
};

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task.created") }),
  z.object({
    type: z.literal("task.moved"),
    fromColumnId: z.uuid().nullish(),
    toColumnId: z.uuid().nullish(),
  }),
  z.object({ type: z.literal("branch.created") }),
  z.object({ type: z.literal("pr.opened") }),
  z.object({ type: z.literal("pr.merged") }),
  z.object({ type: z.literal("task.due_soon"), hoursBefore: z.number().int().min(1).max(24 * 30) }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

export const conditionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("priority"),
    op: z.enum(["in", "not_in"]),
    values: z.array(z.enum(PRIORITIES)).min(1, "Elegí al menos una prioridad"),
  }),
  z.object({ type: z.literal("tag"), op: z.enum(["has", "not_has"]), tagId: z.uuid("Elegí un tag") }),
  z.object({ type: z.literal("epic"), op: z.enum(["is", "is_not"]), epicId: z.uuid().nullable() }),
  z.object({ type: z.literal("assignee"), op: z.enum(["is", "is_not"]), userId: z.string().min(1).nullable() }),
  z.object({ type: z.literal("column"), op: z.enum(["is", "is_not"]), columnId: z.uuid("Elegí una columna") }),
  z.object({ type: z.literal("is_subtask"), value: z.boolean() }),
]);
export type Condition = z.infer<typeof conditionSchema>;

export const CONDITION_LABELS: Record<Condition["type"], string> = {
  priority: "Prioridad",
  tag: "Tag",
  epic: "Epic",
  assignee: "Responsable",
  column: "Columna actual",
  is_subtask: "Tipo",
};

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move_to_column"), columnId: z.uuid("Elegí una columna") }),
  z.object({ type: z.literal("assign"), userId: z.string().min(1).nullable() }),
  z.object({ type: z.literal("add_tag"), tagId: z.uuid("Elegí un tag") }),
  z.object({ type: z.literal("remove_tag"), tagId: z.uuid("Elegí un tag") }),
  z.object({ type: z.literal("add_comment"), body: z.string().trim().min(1, "El comentario está vacío").max(5000) }),
]);
export type Action = z.infer<typeof actionSchema>;

export const ACTION_LABELS: Record<Action["type"], string> = {
  move_to_column: "Mover a la columna",
  assign: "Asignar responsable",
  add_tag: "Agregar tag",
  remove_tag: "Quitar tag",
  add_comment: "Agregar comentario",
};

export const ruleInputSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre").max(120),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1, "Agregá al menos una acción").max(10),
});
export type RuleInput = z.infer<typeof ruleInputSchema>;

/** Variables disponibles en los comentarios automáticos. */
export const TEMPLATE_VARIABLES = [
  { key: "task.key", description: "Clave de la tarea (TDA-12)" },
  { key: "task.title", description: "Título de la tarea" },
  { key: "pr.number", description: "Número del PR" },
  { key: "pr.title", description: "Título del PR" },
  { key: "pr.url", description: "Enlace al PR" },
  { key: "branch", description: "Nombre de la rama" },
  { key: "repo", description: "Repositorio" },
  { key: "due_date", description: "Fecha límite" },
] as const;
