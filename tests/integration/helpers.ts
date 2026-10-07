import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { boardColumns, projectMembers, user } from "@/server/db/schema";
import type { Role } from "@/server/permissions";
import type { Actor } from "@/server/permissions/access";
import { createProject } from "@/server/services/projects";

export type TestUser = { id: string; name: string; email: string };

let counter = 0;

export async function createUser(name = `Usuario ${++counter}`): Promise<TestUser> {
  const id = randomUUID();
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${id.slice(0, 6)}@test.local`;
  await db.insert(user).values({ id, name, email, emailVerified: true });
  return { id, name, email };
}

export const as = (u: TestUser): Actor => ({ type: "user", userId: u.id });

export async function createTestProject(owner: TestUser, key = `P${(++counter).toString(36).toUpperCase()}X`) {
  const project = await createProject(as(owner), { name: `Proyecto ${key}`, key });
  const columns = await db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.projectId, project.id))
    .orderBy(asc(boardColumns.rank));
  const [todo, doing, review, done] = columns;
  return { project, columns: { todo, doing, review, done } };
}

export async function addMember(projectId: string, member: TestUser, role: Exclude<Role, "owner">) {
  await db.insert(projectMembers).values({ projectId, userId: member.id, role });
}

/** Proyecto con un usuario por rol más alguien de afuera. */
export async function projectWithRoles() {
  const [owner, editor, viewer, outsider] = await Promise.all([
    createUser("Dueña"),
    createUser("Editor"),
    createUser("Lector"),
    createUser("Ajeno"),
  ]);
  const { project, columns } = await createTestProject(owner);
  await addMember(project.id, editor, "editor");
  await addMember(project.id, viewer, "viewer");
  return { project, columns, owner, editor, viewer, outsider };
}
