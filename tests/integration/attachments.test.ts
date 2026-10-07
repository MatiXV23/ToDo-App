import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { addAttachment, deleteAttachment, getAttachmentForDownload } from "@/server/services/attachments";
import { createTask, getTaskDetail } from "@/server/services/tasks";
import { detectImage } from "@/server/storage";
import { as, projectWithRoles } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "todoapp-uploads-"));
  process.env.UPLOADS_DIR = dir;
});

describe("adjuntos", () => {
  it("detecta imágenes por contenido, no por extensión", () => {
    expect(detectImage(PNG)?.contentType).toBe("image/png");
    expect(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.ext).toBe("jpg");
    expect(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImage(Buffer.from("texto plano cualquiera"))).toBeNull();
  });

  it("guarda, lista, sirve y borra imágenes", async () => {
    const { project, owner, viewer } = await projectWithRoles();
    const task = await createTask(as(owner), { projectId: project.id, title: "Con evidencia" });
    const row = await addAttachment(as(owner), { taskId: task.id, fileName: "captura.png", data: PNG });
    expect(existsSync(path.join(dir, row.storageKey))).toBe(true);

    const detail = await getTaskDetail(as(viewer), task.id);
    expect(detail.attachments).toMatchObject([{ fileName: "captura.png", contentType: "image/png", url: `/api/attachments/${row.id}` }]);
    expect(detail.activity.some((a) => a.kind === "attached")).toBe(true);
    await expect(getAttachmentForDownload(as(viewer), row.id)).resolves.toMatchObject({ id: row.id });

    await deleteAttachment(as(owner), row.id);
    expect(existsSync(path.join(dir, row.storageKey))).toBe(false);
    expect((await getTaskDetail(as(owner), task.id)).attachments).toEqual([]);
  });

  it("rechaza archivos que no son imágenes o demasiado grandes", async () => {
    const { project, owner } = await projectWithRoles();
    const task = await createTask(as(owner), { projectId: project.id, title: "T" });
    await expect(addAttachment(as(owner), { taskId: task.id, fileName: "x.png", data: Buffer.from("<svg></svg>") })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const huge = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    await expect(addAttachment(as(owner), { taskId: task.id, fileName: "big.png", data: huge })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("solo lectura puede ver pero no subir ni borrar; alguien de afuera no ve nada", async () => {
    const { project, owner, viewer, outsider } = await projectWithRoles();
    const task = await createTask(as(owner), { projectId: project.id, title: "T" });
    await expect(addAttachment(as(viewer), { taskId: task.id, fileName: "x.png", data: PNG })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const row = await addAttachment(as(owner), { taskId: task.id, fileName: "x.png", data: PNG });
    await expect(deleteAttachment(as(viewer), row.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAttachmentForDownload(as(outsider), row.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
