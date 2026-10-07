/** Constantes y helpers del dominio compartidos entre cliente y servidor. */

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_META: Record<Priority, { label: string; className: string; weight: number }> = {
  urgent: { label: "Urgente", className: "text-red-600", weight: 4 },
  high: { label: "Alta", className: "text-orange-500", weight: 3 },
  medium: { label: "Media", className: "text-amber-500", weight: 2 },
  low: { label: "Baja", className: "text-sky-500", weight: 1 },
};

export const COLUMN_CATEGORIES = ["todo", "in_progress", "done"] as const;
export type ColumnCategory = (typeof COLUMN_CATEGORIES)[number];
export const COLUMN_CATEGORY_LABELS: Record<ColumnCategory, string> = {
  todo: "Pendiente",
  in_progress: "En progreso",
  done: "Terminado",
};

export const DEFAULT_COLUMNS: { name: string; category: ColumnCategory }[] = [
  { name: "Por hacer", category: "todo" },
  { name: "En curso", category: "in_progress" },
  { name: "En revisión", category: "in_progress" },
  { name: "Hecho", category: "done" },
];

export const PALETTE = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#64748b",
] as const;

export const PR_STATES = ["draft", "open", "in_review", "merged", "closed"] as const;
export type PrState = (typeof PR_STATES)[number];
export const PR_STATE_META: Record<PrState, { label: string; className: string }> = {
  draft: { label: "Borrador", className: "bg-zinc-100 text-zinc-600" },
  open: { label: "Abierto", className: "bg-green-100 text-green-700" },
  in_review: { label: "En revisión", className: "bg-amber-100 text-amber-700" },
  merged: { label: "Mergeado", className: "bg-purple-100 text-purple-700" },
  closed: { label: "Cerrado", className: "bg-red-100 text-red-700" },
};

export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

export function taskKey(projectKey: string, number: number) {
  return `${projectKey}-${number}`;
}

export function parseTaskKey(value: string): { projectKey: string; number: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { projectKey: match[1].toUpperCase(), number: Number(match[2]) };
}

export function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Nombre de rama a partir del identificador y el título: `tda-42-revisar-el-deploy`. */
export function branchNameFor(projectKey: string, number: number, title: string, maxLength = 60) {
  const prefix = `${projectKey.toLowerCase()}-${number}`;
  const slug = slugify(title);
  if (!slug) return prefix;
  return `${prefix}-${slug}`.slice(0, maxLength).replace(/-+$/, "");
}

/** Sugerencia de clave a partir del nombre: "Mi App Web" → "MAW". */
export function suggestProjectKey(name: string) {
  const words = slugify(name).split("-").filter(Boolean);
  if (words.length === 0) return "";
  const key =
    words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join("").slice(0, 5);
  const upper = key.toUpperCase().replace(/^[0-9]+/, "");
  return upper.length >= 2 ? upper : (upper + "PRJ").slice(0, 3);
}

export function formatHours(hours: number | null | undefined) {
  if (hours == null) return "";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}
