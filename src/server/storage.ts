import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** Almacenamiento de archivos en disco (en producción, un volumen de Docker). */

const KEY_RE = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

function uploadsDir() {
  return process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
}

function resolveKey(key: string) {
  // Las claves las genera el servidor; igual se validan para evitar rutas arbitrarias.
  if (!KEY_RE.test(key)) throw new Error("Clave de archivo inválida");
  return path.join(uploadsDir(), key);
}

export async function saveFile(key: string, data: Buffer) {
  await mkdir(uploadsDir(), { recursive: true });
  await writeFile(resolveKey(key), data);
}

export function readStoredFile(key: string) {
  return readFile(resolveKey(key));
}

export async function deleteStoredFile(key: string) {
  await unlink(resolveKey(key)).catch(() => {});
}

export type ImageType = { ext: "png" | "jpg" | "gif" | "webp"; contentType: string };

/** Detecta el tipo por los primeros bytes (no por la extensión). SVG no se acepta. */
export function detectImage(data: Buffer): ImageType | null {
  if (data.length < 12) return null;
  if (data[0] === 0x89 && data.subarray(1, 4).toString("ascii") === "PNG") return { ext: "png", contentType: "image/png" };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (data.subarray(0, 4).toString("ascii") === "GIF8") return { ext: "gif", contentType: "image/gif" };
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}
