import { asc, eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import { tags } from "@/server/db/schema";
import { conflict, notFound } from "@/server/errors";
import { projectChannel, publish } from "@/server/events";
import { type Actor, authorize } from "@/server/permissions/access";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido");
const name = z.string().trim().min(1, "Poné un nombre").max(30);

export const createTagSchema = z.object({ projectId: z.uuid(), name, color });
export const updateTagSchema = z.object({ tagId: z.uuid(), name: name.optional(), color: color.optional() });

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function listTags(actor: Actor, projectId: string) {
  await authorize(db, actor, projectId, "project.view");
  return db.select().from(tags).where(eq(tags.projectId, projectId)).orderBy(asc(tags.name));
}

export async function createTag(actor: Actor, input: z.input<typeof createTagSchema>) {
  const data = createTagSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      await authorize(tx, actor, data.projectId, "tag.manage");
      const [tag] = await tx.insert(tags).values(data).returning();
      await publish(tx, projectChannel(data.projectId), { type: "board" }, actor);
      return tag;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`Ya existe el tag "${data.name}"`);
    throw err;
  }
}

export async function updateTag(actor: Actor, input: z.input<typeof updateTagSchema>) {
  const { tagId, ...patch } = updateTagSchema.parse(input);
  const [tag] = await db.select().from(tags).where(eq(tags.id, tagId));
  if (!tag) throw notFound("Tag");
  try {
    return await db.transaction(async (tx) => {
      await authorize(tx, actor, tag.projectId, "tag.manage");
      const [updated] = await tx.update(tags).set(patch).where(eq(tags.id, tagId)).returning();
      await publish(tx, projectChannel(tag.projectId), { type: "board" }, actor);
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`Ya existe el tag "${patch.name}"`);
    throw err;
  }
}

export async function deleteTag(actor: Actor, tagId: string) {
  const [tag] = await db.select().from(tags).where(eq(tags.id, tagId));
  if (!tag) throw notFound("Tag");
  await db.transaction(async (tx) => {
    await authorize(tx, actor, tag.projectId, "tag.manage");
    await tx.delete(tags).where(eq(tags.id, tagId));
    await publish(tx, projectChannel(tag.projectId), { type: "board" }, actor);
  });
}
