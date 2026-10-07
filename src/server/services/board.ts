import { and, asc, eq, getTableColumns, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { boardColumns, epics, projectMembers, projects, sprints, tags, tasks, user } from "@/server/db/schema";
import { notFound } from "@/server/errors";
import { allowedActions } from "@/server/permissions";
import { type Actor, authorize } from "@/server/permissions/access";

/**
 * Referencia calificada a tasks.id para subconsultas correlacionadas: Drizzle escribe
 * `${tasks.id}` como "id" a secas, que dentro de la subconsulta apuntaría a su propia tabla.
 */
const OUTER_TASK_ID = sql.raw('"tasks"."id"');
const OUTER_COLUMN_ID = sql.raw('"board_columns"."id"');

/**
 * Todo lo que necesita el tablero en una sola consulta lógica. Con sprints activados
 * muestra solo el sprint activo; sin sprints, todas las tareas.
 * El filtrado por responsable, tag, etc. se hace en el cliente para que sea instantáneo.
 */
export async function getBoard(actor: Actor, projectId: string) {
  const role = await authorize(db, actor, projectId, "project.view");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw notFound("Proyecto");

  const activeSprint = project.sprintsEnabled
    ? ((
        await db
          .select()
          .from(sprints)
          .where(and(eq(sprints.projectId, projectId), eq(sprints.status, "active")))
      )[0] ?? null)
    : null;

  const taskScope = [eq(tasks.projectId, projectId), isNull(tasks.deletedAt)];
  if (project.sprintsEnabled) {
    taskScope.push(activeSprint ? eq(tasks.sprintId, activeSprint.id) : sql`false`);
  }

  const [columns, members, tagRows, epicRows, plannedSprints, taskRows] = await Promise.all([
    db
      .select({
        ...getTableColumns(boardColumns),
        autoTagIds: sql<string[]>`coalesce((select array_agg(ct.tag_id) from board_column_tags ct where ct.column_id = ${OUTER_COLUMN_ID}), '{}')`,
      })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId))
      .orderBy(asc(boardColumns.rank)),
    db
      .select({ id: user.id, name: user.name, email: user.email, image: user.image, role: projectMembers.role })
      .from(projectMembers)
      .innerJoin(user, eq(user.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(user.name)),
    db.select().from(tags).where(eq(tags.projectId, projectId)).orderBy(asc(tags.name)),
    db
      .select({ id: epics.id, title: epics.title, color: epics.color, status: epics.status })
      .from(epics)
      .where(and(eq(epics.projectId, projectId), isNull(epics.deletedAt)))
      .orderBy(asc(epics.rank)),
    db
      .select({ id: sprints.id, name: sprints.name, status: sprints.status })
      .from(sprints)
      .where(and(eq(sprints.projectId, projectId), ne(sprints.status, "completed")))
      .orderBy(asc(sprints.createdAt)),
    db
      .select({
        id: tasks.id,
        number: tasks.number,
        title: tasks.title,
        priority: tasks.priority,
        assigneeId: tasks.assigneeId,
        epicId: tasks.epicId,
        columnId: tasks.columnId,
        sprintId: tasks.sprintId,
        rank: tasks.rank,
        parentId: tasks.parentId,
        dueDate: tasks.dueDate,
        completedAt: tasks.completedAt,
        tagIds: sql<string[]>`coalesce((select array_agg(tt.tag_id) from task_tags tt where tt.task_id = ${OUTER_TASK_ID}), '{}')`,
        subtaskTotal: sql<number>`(select count(*) from tasks st where st.parent_id = ${OUTER_TASK_ID} and st.deleted_at is null)`.mapWith(Number),
        subtaskDone: sql<number>`(select count(*) from tasks st where st.parent_id = ${OUTER_TASK_ID} and st.deleted_at is null and st.completed_at is not null)`.mapWith(Number),
        commentCount: sql<number>`(select count(*) from comments c where c.task_id = ${OUTER_TASK_ID})`.mapWith(Number),
        attachmentCount: sql<number>`(select count(*) from task_attachments a where a.task_id = ${OUTER_TASK_ID})`.mapWith(Number),
        agentStatus: tasks.agentStatus,
        reviewStatus: tasks.reviewStatus,
        prState: sql<string | null>`(
          select l.state from task_vcs_links l
          where l.task_id = ${OUTER_TASK_ID} and l.kind = 'pull_request'
          order by case l.state when 'in_review' then 1 when 'open' then 2 when 'draft' then 3 when 'merged' then 4 else 5 end
          limit 1)`,
      })
      .from(tasks)
      .where(and(...taskScope))
      .orderBy(asc(tasks.rank), asc(tasks.id)),
  ]);

  return {
    project: { ...project, role, can: allowedActions(role) },
    activeSprint,
    sprints: plannedSprints,
    columns,
    members,
    tags: tagRows,
    epics: epicRows,
    tasks: taskRows,
  };
}

export type BoardData = Awaited<ReturnType<typeof getBoard>>;
export type BoardTask = BoardData["tasks"][number];
