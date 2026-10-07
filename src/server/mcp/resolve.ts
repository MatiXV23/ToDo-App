import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { boardColumns, epics, projectMembers, tags, user } from "@/server/db/schema";
import { badRequest } from "@/server/errors";
import { env } from "@/server/env";
import type { Actor } from "@/server/permissions/access";
import { getProjectByKey } from "@/server/services/projects";
import { createTag } from "@/server/services/tags";
import { findTaskId } from "@/server/services/tasks";
import { PALETTE, parseTaskKey, slugify } from "@/lib/domain";

/**
 * Traducción de referencias "humanas" (claves, nombres, emails) a ids.
 * Así Claude puede decir "TDA-12", "En curso" o "ana@gmail.com" en lugar de UUIDs.
 */

const norm = (s: string) => slugify(s);

export async function resolveProject(actor: Actor, key: string) {
  return getProjectByKey(actor, key.trim());
}

export async function resolveTask(actor: Actor, key: string) {
  const parsed = parseTaskKey(key);
  if (!parsed) throw badRequest(`"${key}" no es una clave de tarea válida (ej. TDA-12)`);
  const project = await getProjectByKey(actor, parsed.projectKey);
  const taskId = await findTaskId(actor, project.id, parsed.number);
  return { project, taskId };
}

export async function resolveColumn(projectId: string, ref: string) {
  const columns = await db.select().from(boardColumns).where(eq(boardColumns.projectId, projectId));
  const found = columns.find((c) => c.id === ref || norm(c.name) === norm(ref));
  if (!found) throw badRequest(`No existe la columna "${ref}". Columnas: ${columns.map((c) => c.name).join(", ")}`);
  return found;
}

export async function resolveMember(actor: Actor, projectId: string, ref: string | null | undefined) {
  if (ref === undefined) return undefined;
  if (ref === null || ref === "" || norm(ref) === "nadie" || norm(ref) === "none") return null;
  const members = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId));
  if (norm(ref) === "me" || norm(ref) === "yo") {
    const me = members.find((m) => actor.type === "user" && m.id === actor.userId);
    if (me) return me.id;
  }
  const found =
    members.find((m) => m.email.toLowerCase() === ref.toLowerCase() || m.id === ref) ??
    members.find((m) => norm(m.name) === norm(ref)) ??
    members.find((m) => norm(m.name).split("-")[0] === norm(ref));
  if (!found) throw badRequest(`"${ref}" no es miembro del proyecto. Miembros: ${members.map((m) => `${m.name} <${m.email}>`).join(", ")}`);
  return found.id;
}

/** Ids de tags por nombre; los que no existen se crean si el actor puede. */
export async function resolveTags(actor: Actor, projectId: string, names: string[] | undefined) {
  if (names === undefined) return undefined;
  const existing = await db.select().from(tags).where(eq(tags.projectId, projectId));
  const ids: string[] = [];
  for (const name of names) {
    const found = existing.find((t) => norm(t.name) === norm(name) || t.id === name);
    if (found) ids.push(found.id);
    else {
      const created = await createTag(actor, { projectId, name: name.trim(), color: PALETTE[(existing.length + ids.length) % PALETTE.length] });
      ids.push(created.id);
    }
  }
  return [...new Set(ids)];
}

export async function resolveEpic(projectId: string, ref: string | null | undefined) {
  if (ref === undefined) return undefined;
  if (ref === null || ref === "") return null;
  const rows = await db
    .select({ id: epics.id, title: epics.title })
    .from(epics)
    .where(and(eq(epics.projectId, projectId), isNull(epics.deletedAt)));
  const found = rows.find((e) => e.id === ref || norm(e.title) === norm(ref));
  if (!found) throw badRequest(`No existe el epic "${ref}". Epics: ${rows.map((e) => e.title).join(", ") || "(ninguno)"}`);
  return found.id;
}

export const taskUrl = (projectKey: string, key: string) => `${env.appUrl}/p/${projectKey}?task=${key}`;
export const absoluteUrl = (path: string) => `${env.appUrl}${path}`;
