import { differenceInCalendarDays, format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { es } from "date-fns/locale";

export function timeAgo(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  if (diff < 45_000) return "recién";
  return `hace ${formatDistanceToNowStrict(d, { locale: es })}`;
}

export function formatDate(date: Date | string, pattern = "d MMM") {
  const d = typeof date === "string" ? (date.length === 10 ? parseISO(date) : new Date(date)) : date;
  return format(d, pattern, { locale: es });
}

export function formatDateTime(date: Date | string) {
  return formatDate(date, "d MMM yyyy, HH:mm");
}

/** Estado de una fecha límite (YYYY-MM-DD) respecto de hoy. */
export function dueStatus(dueDate: string, done = false): "overdue" | "today" | "soon" | "later" | "done" {
  if (done) return "done";
  const days = differenceInCalendarDays(parseISO(dueDate), new Date());
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 2) return "soon";
  return "later";
}

export function initials(name: string) {
  return name
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}
