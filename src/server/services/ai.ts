import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { and, asc, count, eq, gte, isNull, or, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import { aiUsage, boardColumns, epics, projectMembers, projects, sprints, tags, tasks, user } from "@/server/db/schema";
import { AiError, generateObject, getAiProvider } from "@/server/ai";
import type { ChatMessage } from "@/server/ai/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import type { Action } from "@/server/permissions";
import { type Actor, authorize } from "@/server/permissions/access";
import { PRIORITIES, PRIORITY_META, slugify, taskKey } from "@/lib/domain";
import { getEpic } from "./epics";
import { getTaskDetail } from "./tasks";

const SYSTEM = `Sos el asistente de una app de gestión de tareas tipo Kanban (proyectos, epics, tareas y subtareas).
Escribís en español rioplatense, con frases claras y concretas, sin relleno.
Tus respuestas son sugerencias que una persona revisa antes de aplicar: no inventes datos que no te dieron.
Respondé siempre con un único objeto JSON válido, sin texto adicional.`;

const RATE_LIMIT = () => Number(process.env.AI_RATE_LIMIT ?? 30);
const RATE_WINDOW_MIN = 10;

/** Permisos, límite de uso y registro de consumo comunes a todas las funciones. */
async function runFeature<T>(
  actor: Actor,
  projectId: string,
  feature: string,
  action: Action,
  fn: () => Promise<{ data: T; model: string; usage: { inputTokens: number; outputTokens: number } }>,
): Promise<T> {
  if (actor.type !== "user") throw forbidden();
  await authorize(db, actor, projectId, action);
  const [{ n }] = await db
    .select({ n: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, actor.userId), gte(aiUsage.createdAt, sql`now() - make_interval(mins => ${RATE_WINDOW_MIN})`)));
  if (n >= RATE_LIMIT()) {
    throw new AppError("TOO_MANY_REQUESTS", `Llegaste al límite de ${RATE_LIMIT()} pedidos a la IA cada ${RATE_WINDOW_MIN} minutos`);
  }
  const started = Date.now();
  const log = (status: string, model = process.env.AI_MODEL ?? "", usage = { inputTokens: 0, outputTokens: 0 }) =>
    db.insert(aiUsage).values({
      userId: actor.userId,
      projectId,
      feature,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs: Date.now() - started,
      status,
    });
  try {
    const result = await fn();
    await log("ok", result.model, result.usage);
    return result.data;
  } catch (err) {
    await log(err instanceof AiError ? err.kind : "error");
    if (err instanceof AiError) {
      throw new AppError(err.kind === "not_configured" ? "PRECONDITION_FAILED" : "BAD_REQUEST", err.message);
    }
    throw err;
  }
}

async function projectContext(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw notFound("Proyecto");
  const [tagRows, memberRows, epicRows] = await Promise.all([
    db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.projectId, projectId)).orderBy(asc(tags.name)),
    db
      .select({ id: user.id, name: user.name })
      .from(projectMembers)
      .innerJoin(user, eq(user.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId)),
    db
      .select({ id: epics.id, title: epics.title })
      .from(epics)
      .where(and(eq(epics.projectId, projectId), isNull(epics.deletedAt), eq(epics.status, "open"))),
  ]);
  return { project, tags: tagRows, members: memberRows, epics: epicRows };
}

const quote = (text: string) => `"""\n${text.trim() || "(vacío)"}\n"""`;
const messages = (userPrompt: string): ChatMessage[] => [
  { role: "system", content: SYSTEM },
  { role: "user", content: userPrompt },
];

// ─── 1. Dividir en subtareas ────────────────────────────────────────────

const splitSchema = z.object({
  subtasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(2000).nullish(),
        estimateHours: z.number().min(0).max(200).nullish(),
      }),
    )
    .min(1)
    .max(12),
});
export type SplitSuggestion = z.infer<typeof splitSchema>["subtasks"];

export async function suggestSplit(actor: Actor, input: { taskId?: string; epicId?: string }) {
  if (input.taskId) {
    const task = await getTaskDetail(actor, input.taskId);
    return runFeature(actor, task.projectId, "split_task", "ai.use", async () => {
      const ctx = await projectContext(task.projectId);
      const existing = task.subtasks.map((s) => `- ${s.title}`).join("\n");
      return generateObject(
        splitSchema,
        messages(`Dividí esta tarea en subtareas accionables (entre 2 y 8), en el orden en que conviene hacerlas.
Cada subtarea tiene que poder completarse en menos de un día. Estimá horas solo si hay información suficiente.

Proyecto: ${ctx.project.name}
Tarea ${task.key}: ${task.title}
Descripción:
${quote(task.descriptionMd)}
${existing ? `Subtareas que ya existen (no las repitas):\n${existing}\n` : ""}
Formato JSON: {"subtasks":[{"title":"verbo en infinitivo + objeto, máximo 100 caracteres","description":"opcional, 1 o 2 frases","estimateHours":número o null}]}`),
        { maxTokens: 1500 },
      );
    }).then((r) => r.subtasks);
  }
  if (input.epicId) {
    const epic = await getEpic(actor, input.epicId);
    return runFeature(actor, epic.projectId, "split_epic", "ai.use", async () => {
      const ctx = await projectContext(epic.projectId);
      const existing = epic.tasks.map((t) => `- ${t.title}`).join("\n");
      return generateObject(
        splitSchema,
        messages(`Dividí este epic en tareas concretas (entre 3 y 10) que, juntas, cumplan su objetivo.
Cada tarea tiene que poder hacerse en uno a tres días. Ordenalas por dependencia.

Proyecto: ${ctx.project.name}
Epic: ${epic.title}
Descripción:
${quote(epic.descriptionMd)}
${existing ? `Tareas que ya existen en el epic (no las repitas):\n${existing}\n` : ""}
Formato JSON: {"subtasks":[{"title":"verbo en infinitivo + objeto, máximo 100 caracteres","description":"opcional, 1 o 2 frases","estimateHours":número o null}]}`),
        { maxTokens: 2000 },
      );
    }).then((r) => r.subtasks);
  }
  throw new AppError("BAD_REQUEST", "Indicá una tarea o un epic");
}

// ─── 2. Redactar o mejorar la descripción ───────────────────────────────

const descriptionSchema = z.object({ descriptionMd: z.string().trim().min(1).max(20_000) });

export async function suggestDescription(
  actor: Actor,
  input: { projectId: string; title: string; note?: string; current?: string },
) {
  return runFeature(actor, input.projectId, "description", "ai.use", async () => {
    const ctx = await projectContext(input.projectId);
    const improving = !!input.current?.trim();
    return generateObject(
      descriptionSchema,
      messages(`${
        improving
          ? "Mejorá la descripción de esta tarea: corregí la redacción, ordená y completá lo que falte sin cambiar el sentido."
          : "Redactá la descripción de esta tarea a partir del título y la nota."
      }
Usá Markdown. Estructura sugerida (incluí solo lo que aporte): un párrafo breve de contexto, "### Qué hay que hacer" con pasos, "### Criterios de aceptación" como checklist "- [ ]".
Si la información es escasa no inventes detalles técnicos: agregá "### Dudas" con preguntas abiertas. Máximo unas 200 palabras.

Proyecto: ${ctx.project.name}
Título: ${input.title}
${improving ? `Descripción actual:\n${quote(input.current!)}` : `Nota:\n${quote(input.note ?? "")}`}

Formato JSON: {"descriptionMd":"..."}`),
      { maxTokens: 1200 },
    );
  }).then((r) => r.descriptionMd);
}

// ─── 3. Sugerir prioridad, estimación y tags ────────────────────────────

const fieldsSchema = z.object({
  priority: z.enum(PRIORITIES),
  estimateHours: z.number().min(0).max(200).nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(4),
  reasoning: z.string().max(600),
});

export async function suggestFields(actor: Actor, taskId: string) {
  const task = await getTaskDetail(actor, taskId);
  const result = await runFeature(actor, task.projectId, "fields", "ai.use", async () => {
    const ctx = await projectContext(task.projectId);
    return generateObject(
      fieldsSchema,
      messages(`Sugerí prioridad, estimación en horas y tags para esta tarea.
Prioridades: low (baja), medium (media), high (alta), urgent (urgente). Usá urgent solo si hay un bloqueo o impacto inmediato.
Estimación: horas de trabajo efectivo entre 0.5 y 40, o null si no hay información suficiente.
Tags existentes en el proyecto: ${ctx.tags.length ? ctx.tags.map((t) => t.name).join(", ") : "(ninguno)"}.
Preferí tags existentes (escribilos igual). Proponé como mucho uno nuevo si ninguno encaja. Máximo 3 tags.

Tarea ${task.key}: ${task.title}
Descripción:
${quote(task.descriptionMd)}
Subtareas: ${task.subtasks.length}

Formato JSON: {"priority":"low|medium|high|urgent","estimateHours":número o null,"tags":["nombre"],"reasoning":"una o dos frases"}`),
      { maxTokens: 500, temperature: 0.2 },
    );
  });
  const ctx = await projectContext(task.projectId);
  const byName = new Map(ctx.tags.map((t) => [slugify(t.name), t]));
  const existing = result.tags.map((name) => byName.get(slugify(name))).filter((t) => !!t);
  const newTags = result.tags.filter((name) => !byName.has(slugify(name)));
  return {
    priority: result.priority,
    estimateHours: result.estimateHours,
    tagIds: [...new Set(existing.map((t) => t.id))],
    newTags: [...new Set(newTags)],
    reasoning: result.reasoning,
  };
}

// ─── 4. Resumir un sprint o el proyecto ─────────────────────────────────

const summarySchema = z.object({ summaryMd: z.string().trim().min(1).max(10_000) });

export async function summarize(actor: Actor, input: { sprintId?: string; projectId?: string }) {
  let projectId = input.projectId;
  let sprint: typeof sprints.$inferSelect | null = null;
  if (input.sprintId) {
    [sprint] = await db.select().from(sprints).where(eq(sprints.id, input.sprintId));
    if (!sprint) throw notFound("Sprint");
    projectId = sprint.projectId;
  }
  if (!projectId) throw new AppError("BAD_REQUEST", "Indicá un sprint o un proyecto");
  const pid = projectId;

  return runFeature(actor, pid, "summary", "ai.summarize", async () => {
    const ctx = await projectContext(pid);
    const scope = sprint
      ? eq(tasks.sprintId, sprint.id)
      : or(isNull(tasks.completedAt), gte(tasks.completedAt, sql`now() - interval '14 days'`));
    const rows = await db
      .select({
        number: tasks.number,
        title: tasks.title,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        estimateHours: tasks.estimateHours,
        completedAt: tasks.completedAt,
        column: boardColumns.name,
        category: boardColumns.category,
        assignee: user.name,
      })
      .from(tasks)
      .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
      .leftJoin(user, eq(user.id, tasks.assigneeId))
      .where(and(eq(tasks.projectId, pid), isNull(tasks.deletedAt), isNull(tasks.parentId), scope))
      .orderBy(asc(tasks.number))
      .limit(150);
    const today = new Date().toISOString().slice(0, 10);
    const lines = rows.map((t) =>
      [
        `- [${t.column}${t.category === "done" ? " ✓" : ""}] ${taskKey(ctx.project.key, t.number)} ${t.title}`,
        `prioridad ${PRIORITY_META[t.priority].label.toLowerCase()}`,
        t.assignee ? `responsable ${t.assignee}` : "sin responsable",
        t.dueDate ? `vence ${t.dueDate}${!t.completedAt && t.dueDate < today ? " (VENCIDA)" : ""}` : null,
        t.estimateHours ? `${t.estimateHours} h` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    const done = rows.filter((r) => r.category === "done").length;
    const header = sprint
      ? `Sprint: ${sprint.name}${sprint.goal ? ` · objetivo: ${sprint.goal}` : ""} · ${sprint.startDate ?? "?"} a ${sprint.endDate ?? "?"}`
      : `Proyecto: ${ctx.project.name} (tareas abiertas y terminadas en los últimos 14 días)`;
    return generateObject(
      summarySchema,
      messages(`Resumí el estado del ${sprint ? "sprint" : "proyecto"} para alguien que lo sigue de cerca.
Incluí: avance general con números, qué se terminó, qué está en curso, riesgos o bloqueos (vencidas, urgentes sin avanzar, tareas sin responsable) y de 1 a 3 próximos pasos sugeridos.
Markdown breve con viñetas, máximo unas 180 palabras. Usá solo los datos de abajo.

Hoy: ${today}
${header}
Tareas: ${rows.length} (${done} terminadas)
${lines.join("\n") || "(sin tareas)"}

Formato JSON: {"summaryMd":"..."}`),
      { maxTokens: 900 },
    );
  }).then((r) => r.summaryMd);
}

// ─── 5. Crear tareas a partir de texto libre ────────────────────────────

const parseSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        descriptionMd: z.string().max(5000).nullish(),
        dueDate: z.iso.date().nullish(),
        priority: z.enum(PRIORITIES).nullish(),
        assignee: z.string().max(100).nullish(),
        tags: z.array(z.string().max(30)).max(5).nullish(),
      }),
    )
    .min(1)
    .max(15),
});

export const parseTasksInput = z.object({
  projectId: z.uuid(),
  text: z.string().trim().min(3, "Escribí qué tenés que hacer").max(4000),
  timezone: z.string().max(64).optional(),
});

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function matchMember(name: string | null | undefined, members: { id: string; name: string }[]) {
  if (!name) return null;
  const target = slugify(name);
  return (
    members.find((m) => slugify(m.name) === target) ??
    members.find((m) => slugify(m.name).split("-")[0] === target.split("-")[0]) ??
    null
  );
}

export async function parseTasks(actor: Actor, input: z.input<typeof parseTasksInput>) {
  const { projectId, text, timezone } = parseTasksInput.parse(input);
  const tz = timezone && isValidTimeZone(timezone) ? timezone : (process.env.APP_TIMEZONE || "UTC");
  const ctx = await projectContext(projectId);
  const result = await runFeature(actor, projectId, "parse_tasks", "ai.use", () => {
    const now = new TZDate(new Date(), tz);
    return generateObject(
      parseSchema,
      messages(`Convertí el texto en tareas concretas, una por acción. Títulos que empiecen con un verbo en infinitivo.
Hoy es ${format(now, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })} (${format(now, "yyyy-MM-dd")}, zona ${tz}).
Interpretá fechas relativas ("mañana", "el viernes", "la semana que viene" = el lunes próximo) como fecha límite YYYY-MM-DD. Sin fecha mencionada: null.
Si se menciona a alguien que es miembro del proyecto como responsable, poné su nombre exacto de la lista.
Si la persona no es miembro (por ejemplo "avisarle a Juan"), dejá la acción en el título ("Avisarle a Juan …") y el responsable en null.
Miembros: ${ctx.members.map((m) => m.name).join(", ") || "(ninguno)"}
Tags existentes (usá solo estos): ${ctx.tags.map((t) => t.name).join(", ") || "(ninguno)"}

Texto:
${quote(text)}

Formato JSON: {"tasks":[{"title":"...","descriptionMd":"opcional","dueDate":"YYYY-MM-DD o null","priority":"low|medium|high|urgent","assignee":"nombre de un miembro o null","tags":["tag existente"]}]}`),
      { maxTokens: 1500, temperature: 0.2 },
    );
  });
  const tagByName = new Map(ctx.tags.map((t) => [slugify(t.name), t.id]));
  return result.tasks.map((t) => ({
    title: t.title,
    descriptionMd: t.descriptionMd ?? "",
    dueDate: t.dueDate ?? null,
    priority: t.priority ?? "medium",
    assigneeId: matchMember(t.assignee, ctx.members)?.id ?? null,
    tagIds: (t.tags ?? []).map((name) => tagByName.get(slugify(name))).filter((id): id is string => !!id),
  }));
}

export function aiStatus() {
  const provider = getAiProvider();
  return { configured: !!provider, model: provider?.model ?? null };
}
