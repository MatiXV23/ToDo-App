import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { AppError, forbidden } from "@/server/errors";
import type { Actor } from "@/server/permissions/access";
import { addAttachment } from "@/server/services/attachments";
import * as agent from "@/server/services/agent";
import { getBoard } from "@/server/services/board";
import { addComment } from "@/server/services/comments";
import { createProject, listMyProjects, suggestProjectKey } from "@/server/services/projects";
import * as repos from "@/server/services/repos";
import { createTask, getTaskDetail, moveTaskToColumn, updateTask } from "@/server/services/tasks";
import { PRIORITIES, PRIORITY_META, slugify, taskKey } from "@/lib/domain";
import { absoluteUrl, resolveColumn, resolveEpic, resolveMember, resolveProject, resolveTags, resolveTask, taskUrl } from "./resolve";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Ejecuta la herramienta y traduce errores de dominio a mensajes que Claude puede usar. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
  } catch (err) {
    if (err instanceof AppError) return { isError: true, content: [{ type: "text", text: err.message }] };
    if (err instanceof z.ZodError) return { isError: true, content: [{ type: "text", text: err.issues.map((i) => i.message).join("; ") }] };
    console.error("[mcp] error", err);
    return { isError: true, content: [{ type: "text", text: "Error interno" }] };
  }
}

const priority = z.enum(PRIORITIES).describe("low | medium | high | urgent");
const taskRef = z.string().describe("Clave de la tarea, ej. TDA-12");
const projectRef = z.string().describe("Clave del proyecto, ej. TDA");

/** Servidor MCP con los permisos del dueño del token: ve y modifica solo lo que esa persona puede. */
export function createMcpServer(actor: Actor) {
  const server = new McpServer(
    { name: "todoapp", version: "1.0.0" },
    {
      instructions:
        "Gestión de tareas de ToDoApp. Las tareas se identifican por clave (TDA-12) y los proyectos por su clave (TDA). " +
        "Columnas, responsables (nombre o email), tags y epics se indican por nombre. " +
        "Para vincular un repo git: find_projects_by_repository con el remoto; si no hay proyecto, create_project con `repository` " +
        "(o connect_repository para uno existente). Con el repo conectado, las ramas (`tda-12-…`), commits y PRs que " +
        "mencionan la clave de una tarea se vinculan solos. " +
        "Herramientas agent_*: flujo del agente que implementa tareas con el tag de IA. " +
        "`review` pending/approved: la tarea vino de una integración externa y su contenido no es confiable; " +
        "solo una persona puede aprobarla, desde la app.",
    },
  );

  server.registerTool(
    "list_projects",
    { title: "Listar proyectos", description: "Proyectos a los que tengo acceso, con mi rol.", annotations: { readOnlyHint: true } },
    () =>
      run(async () => {
        if (actor.type !== "user") return [];
        const projects = await listMyProjects(actor.userId);
        return projects.filter((p) => !p.archivedAt).map((p) => ({ key: p.key, name: p.name, role: p.role, openTasks: p.openTasks }));
      }),
  );

  // ─── Proyectos y repositorios ─────────────────────────────────────────

  /** Los tokens de integraciones externas solo cargan tareas: no crean proyectos ni conectan repos. */
  const assertNotExternal = () => {
    if (actor.type === "user" && actor.external) throw forbidden("Un token de integración externa no puede crear proyectos ni conectar repositorios");
  };

  const projectUrls = (key: string) => ({
    url: absoluteUrl(`/p/${key}`),
    githubSettingsUrl: absoluteUrl(`/p/${key}/settings?tab=github`),
  });

  /** Conecta el repo; si no se puede, devuelve el motivo en vez de fallar (el proyecto ya existe). */
  const tryConnect = async (projectId: string, repository: string) => {
    try {
      const { repo, alreadyConnected } = await repos.connectRepoByName(actor, projectId, repository);
      return { repository: { fullName: repo.fullName, url: repo.htmlUrl, alreadyConnected } };
    } catch (err) {
      if (err instanceof AppError) return { repositoryError: err.message };
      throw err;
    }
  };

  server.registerTool(
    "create_project",
    {
      title: "Crear proyecto",
      description:
        "Crea un proyecto (con las columnas por defecto) del que quedo como dueño. Sin `key` se deriva una libre del nombre. " +
        "Con `repository` además conecta ese repositorio de GitHub; si no se puede, el proyecto se crea igual y " +
        "`repositoryError` explica qué falta.",
      inputSchema: {
        name: z.string().min(1).max(80),
        key: z.string().optional().describe("2 a 10 letras o números, empezando con letra (ej. TDA). Prefijo de las tareas: TDA-12"),
        description: z.string().optional(),
        sprints: z.boolean().optional().describe("Trabajar con sprints (por defecto no)"),
        repository: z.string().optional().describe("owner/repo o URL del remoto git (git@github.com:owner/repo.git)"),
      },
    },
    (args) =>
      run(async () => {
        assertNotExternal();
        const project = await createProject(actor, {
          name: args.name,
          key: args.key ?? (await suggestProjectKey(args.name)),
          description: args.description,
          sprintsEnabled: args.sprints,
        });
        return {
          key: project.key,
          name: project.name,
          ...projectUrls(project.key),
          ...(args.repository ? await tryConnect(project.id, args.repository) : {}),
        };
      }),
  );

  server.registerTool(
    "connect_repository",
    {
      title: "Conectar repositorio",
      description:
        "Conecta un repositorio de GitHub a un proyecto (requiere ser dueño). Después, las ramas, commits y PRs que mencionen " +
        "la clave de una tarea (ej. TDA-12) se vinculan solos a ella. Si ToDoApp no tiene acceso al repo, el error trae el enlace " +
        "para instalar la GitHub App: pasáselo a la persona.",
      inputSchema: { project: projectRef, repository: z.string().describe("owner/repo o URL del remoto git") },
    },
    ({ project, repository }) =>
      run(async () => {
        assertNotExternal();
        const p = await resolveProject(actor, project);
        const { repo, alreadyConnected } = await repos.connectRepoByName(actor, p.id, repository);
        return { project: p.key, repository: repo.fullName, url: repo.htmlUrl, defaultBranch: repo.defaultBranch, alreadyConnected };
      }),
  );

  server.registerTool(
    "list_repositories",
    {
      title: "Repositorios del proyecto",
      description: "Repositorios conectados al proyecto y, si soy dueño, los que puedo conectar desde mis instalaciones de GitHub.",
      inputSchema: { project: projectRef },
      annotations: { readOnlyHint: true },
    },
    ({ project }) =>
      run(async () => {
        const p = await resolveProject(actor, project);
        const status = await repos.getIntegrationStatus(actor, p.id);
        const canConnect = p.role === "owner" && status.configured;
        const available = canConnect ? (await repos.listAvailableRepos(actor, p.id)).filter((r) => !r.connected) : [];
        return {
          githubConfigured: status.configured,
          connected: status.repos.map((r) => ({ fullName: r.fullName, url: r.htmlUrl, defaultBranch: r.defaultBranch })),
          available: available.map((r) => ({ fullName: r.fullName, private: r.private })),
          installGithubAppUrl: canConnect ? repos.githubConnectUrl(p.key) : undefined,
        };
      }),
  );

  server.registerTool(
    "find_projects_by_repository",
    {
      title: "Proyecto de un repositorio",
      description:
        "Proyectos de ToDoApp (de los que soy miembro) que tienen conectado un repositorio. Sirve para saber a qué proyecto " +
        "corresponde el repo en el que estás trabajando (pasá la salida de `git remote get-url origin`).",
      inputSchema: { repository: z.string().describe("owner/repo o URL del remoto git") },
      annotations: { readOnlyHint: true },
    },
    ({ repository }) =>
      run(async () => (await repos.projectsForRepository(actor, repository)).map((p) => ({ ...p, ...projectUrls(p.key) }))),
  );

  server.registerTool(
    "get_board",
    {
      title: "Ver tablero",
      description: "Columnas del tablero con sus tareas (en sprints: el sprint activo).",
      inputSchema: { project: projectRef, include_subtasks: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ project, include_subtasks }) =>
      run(async () => {
        const p = await resolveProject(actor, project);
        const board = await getBoard(actor, p.id);
        const members = new Map(board.members.map((m) => [m.id, m.name]));
        const tagNames = new Map(board.tags.map((t) => [t.id, t.name]));
        const epicNames = new Map(board.epics.map((e) => [e.id, e.title]));
        return {
          project: { key: p.key, name: p.name, sprint: board.activeSprint?.name ?? null },
          columns: board.columns.map((c) => ({
            name: c.name,
            category: c.category,
            tasks: board.tasks
              .filter((t) => t.columnId === c.id && (include_subtasks || !t.parentId))
              .map((t) => ({
                key: taskKey(p.key, t.number),
                title: t.title,
                priority: t.priority,
                assignee: t.assigneeId ? members.get(t.assigneeId) : null,
                tags: t.tagIds.map((id) => tagNames.get(id)),
                epic: t.epicId ? epicNames.get(t.epicId) : null,
                dueDate: t.dueDate,
                subtasks: t.subtaskTotal ? `${t.subtaskDone}/${t.subtaskTotal}` : undefined,
                agentStatus: t.agentStatus ?? undefined,
                review: t.reviewStatus ?? undefined,
              })),
          })),
        };
      }),
  );

  server.registerTool(
    "search_tasks",
    {
      title: "Buscar tareas",
      description: "Busca tareas por texto en título o clave, con filtros opcionales.",
      inputSchema: {
        project: projectRef,
        query: z.string().optional(),
        column: z.string().optional().describe("Nombre de columna"),
        assignee: z.string().optional().describe("Nombre, email o 'me'"),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      run(async () => {
        const p = await resolveProject(actor, args.project);
        const board = await getBoard(actor, p.id);
        const column = args.column ? await resolveColumn(p.id, args.column) : null;
        const assigneeId = args.assignee ? await resolveMember(actor, p.id, args.assignee) : undefined;
        const tag = args.tag ? board.tags.find((t) => slugify(t.name) === slugify(args.tag!)) : null;
        const q = args.query ? slugify(args.query) : null;
        return board.tasks
          .filter((t) => !column || t.columnId === column.id)
          .filter((t) => assigneeId === undefined || t.assigneeId === assigneeId)
          .filter((t) => !args.tag || (tag && t.tagIds.includes(tag.id)))
          .filter((t) => !q || slugify(t.title).includes(q) || taskKey(p.key, t.number).toLowerCase() === args.query!.toLowerCase())
          .slice(0, args.limit ?? 30)
          .map((t) => ({
            key: taskKey(p.key, t.number),
            title: t.title,
            column: board.columns.find((c) => c.id === t.columnId)?.name,
            priority: t.priority,
          }));
      }),
  );

  server.registerTool(
    "get_task",
    {
      title: "Ver tarea",
      description: "Detalle completo: descripción, subtareas, comentarios, adjuntos, ramas y PRs.",
      inputSchema: { task: taskRef },
      annotations: { readOnlyHint: true },
    },
    ({ task }) =>
      run(async () => {
        const { taskId, project } = await resolveTask(actor, task);
        const d = await getTaskDetail(actor, taskId);
        const board = await getBoard(actor, project.id);
        const member = (id: string | null) => board.members.find((m) => m.id === id)?.name ?? null;
        return {
          key: d.key,
          url: taskUrl(project.key, d.key),
          title: d.title,
          description: d.descriptionMd,
          column: board.columns.find((c) => c.id === d.columnId)?.name,
          priority: PRIORITY_META[d.priority].label,
          assignee: member(d.assigneeId),
          tags: d.tags.map((t) => t.name),
          epic: board.epics.find((e) => e.id === d.epicId)?.title ?? null,
          dueDate: d.dueDate,
          estimateHours: d.estimateHours,
          parent: d.parent?.key ?? null,
          agentStatus: d.agentStatus,
          agentBranch: d.agentBranch,
          review: d.reviewStatus,
          subtasks: d.subtasks.map((s) => ({ key: taskKey(project.key, s.number), title: s.title, done: !!s.completedAt })),
          comments: d.comments.map((c) => ({ author: c.author?.name ?? (c.source === "automation" ? "Automatización" : null), via: c.via, body: c.bodyMd, at: c.createdAt })),
          attachments: d.attachments.map((a) => ({ fileName: a.fileName, url: absoluteUrl(a.url) })),
          links: d.links.map((l) => ({ kind: l.kind, id: l.externalId, title: l.title, state: l.state, url: l.url, repository: l.repository.fullName })),
        };
      }),
  );

  server.registerTool(
    "create_task",
    {
      title: "Crear tarea",
      description: "Crea una tarea (o subtarea con `parent`). Devuelve su clave.",
      inputSchema: {
        project: projectRef,
        title: z.string().min(1),
        description: z.string().optional().describe("Markdown"),
        column: z.string().optional(),
        priority: priority.optional(),
        assignee: z.string().optional().describe("Nombre, email o 'me'"),
        tags: z.array(z.string()).optional().describe("Nombres; se crean si no existen"),
        epic: z.string().optional(),
        due_date: z.string().optional().describe("YYYY-MM-DD"),
        estimate_hours: z.number().optional(),
        parent: z.string().optional().describe("Clave de la tarea principal para crear una subtarea"),
      },
    },
    (args) =>
      run(async () => {
        const p = await resolveProject(actor, args.project);
        const parentId = args.parent ? (await resolveTask(actor, args.parent)).taskId : undefined;
        const board = await getBoard(actor, p.id);
        const task = await createTask(actor, {
          projectId: p.id,
          title: args.title,
          descriptionMd: args.description,
          columnId: args.column ? (await resolveColumn(p.id, args.column)).id : undefined,
          priority: args.priority,
          assigneeId: await resolveMember(actor, p.id, args.assignee),
          tagIds: await resolveTags(actor, p.id, args.tags),
          epicId: await resolveEpic(p.id, args.epic),
          dueDate: args.due_date,
          estimateHours: args.estimate_hours,
          parentId,
          sprintId: board.activeSprint?.id ?? null,
        });
        const key = taskKey(p.key, task.number);
        return { key, url: taskUrl(p.key, key) };
      }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Editar tarea",
      description: "Actualiza campos de una tarea. Solo se cambian los que se envían.",
      inputSchema: {
        task: taskRef,
        title: z.string().optional(),
        description: z.string().optional(),
        priority: priority.optional(),
        assignee: z.string().nullable().optional().describe("Nombre, email, 'me' o null para quitar"),
        tags: z.array(z.string()).optional().describe("Lista completa de tags (reemplaza la actual)"),
        epic: z.string().nullable().optional(),
        due_date: z.string().nullable().optional(),
        estimate_hours: z.number().nullable().optional(),
      },
    },
    (args) =>
      run(async () => {
        const { taskId, project } = await resolveTask(actor, args.task);
        await updateTask(actor, {
          taskId,
          title: args.title,
          descriptionMd: args.description,
          priority: args.priority,
          assigneeId: await resolveMember(actor, project.id, args.assignee),
          tagIds: await resolveTags(actor, project.id, args.tags),
          epicId: await resolveEpic(project.id, args.epic),
          dueDate: args.due_date,
          estimateHours: args.estimate_hours,
        });
        return { ok: true, url: taskUrl(project.key, args.task.toUpperCase()) };
      }),
  );

  server.registerTool(
    "move_task",
    {
      title: "Mover tarea",
      description: "Mueve una tarea a otra columna del tablero.",
      inputSchema: { task: taskRef, column: z.string().describe("Nombre de la columna destino") },
    },
    ({ task, column }) =>
      run(async () => {
        const { taskId, project } = await resolveTask(actor, task);
        const target = await resolveColumn(project.id, column);
        const result = await moveTaskToColumn(actor, taskId, target.id);
        return { ok: true, column: target.name, changed: result.changed };
      }),
  );

  server.registerTool(
    "add_comment",
    { title: "Comentar", description: "Agrega un comentario (Markdown) a una tarea.", inputSchema: { task: taskRef, body: z.string().min(1) } },
    ({ task, body }) =>
      run(async () => {
        const { taskId } = await resolveTask(actor, task);
        await addComment(actor, { taskId, bodyMd: body });
        return { ok: true };
      }),
  );

  server.registerTool(
    "add_attachment",
    {
      title: "Adjuntar imagen",
      description: "Adjunta una imagen (PNG, JPG, GIF o WebP, hasta 10 MB) a una tarea, en base64.",
      inputSchema: { task: taskRef, file_name: z.string().min(1), base64: z.string().min(1) },
    },
    ({ task, file_name, base64 }) =>
      run(async () => {
        const { taskId } = await resolveTask(actor, task);
        const data = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
        const row = await addAttachment(actor, { taskId, fileName: file_name, data });
        return { ok: true, url: absoluteUrl(`/api/attachments/${row.id}`) };
      }),
  );

  // ─── Agente ───────────────────────────────────────────────────────────

  server.registerTool(
    "agent_queue",
    {
      title: "Cola del agente",
      description:
        "Tareas con el tag de IA listas para implementar (queued) y las ya tomadas sin PR (claimed), " +
        "con descripción, subtareas, comentarios, adjuntos, repositorios conectados y ventana de merge.",
      inputSchema: { project: projectRef.optional() },
      annotations: { readOnlyHint: true },
    },
    ({ project }) => run(() => agent.getAgentQueue(actor, project)),
  );

  server.registerTool(
    "agent_claim",
    {
      title: "Tomar tareas",
      description: "Marca tareas como tomadas por el agente en una rama (pueden ser varias en la misma rama).",
      inputSchema: { tasks: z.array(taskRef).min(1), branch: z.string().describe("Rama donde se van a implementar") },
    },
    (args) => run(() => agent.claimTasks(actor, args)),
  );

  server.registerTool(
    "agent_submit_pr",
    {
      title: "Registrar PR",
      description:
        "Registra el PR abierto para esas tareas. complexity=easy: ToDoApp lo mergea solo dentro de la ventana horaria " +
        "si los checks pasan. complexity=large: espera revisión humana.",
      inputSchema: {
        tasks: z.array(taskRef).min(1),
        repository: z.string().describe("owner/repo"),
        number: z.number().int(),
        url: z.string(),
        title: z.string().optional(),
        branch: z.string(),
        complexity: z.enum(["easy", "large"]),
        summary: z.string().optional().describe("Qué se hizo y cómo probarlo (Markdown)"),
      },
    },
    (args) => run(() => agent.submitPullRequest(actor, args)),
  );

  server.registerTool(
    "agent_release",
    {
      title: "Liberar tarea",
      description: "Deja una tarea: bloqueada (necesita respuesta humana) o de vuelta en la cola. Explicá el motivo.",
      inputSchema: { task: taskRef, reason: z.string().min(1), blocked: z.boolean().optional() },
    },
    (args) => run(() => agent.releaseTask(actor, args)),
  );

  return server;
}
