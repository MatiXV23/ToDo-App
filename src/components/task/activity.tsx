import { Bot, GitBranch } from "lucide-react";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { formatHours, type Priority, PRIORITY_META } from "@/lib/domain";
import type { TaskDetail } from "./types";

const FIELD_LABELS: Record<string, string> = {
  title: "el título",
  descriptionMd: "la descripción",
  priority: "la prioridad",
  dueDate: "la fecha límite",
  estimateHours: "la estimación",
  epic: "el epic",
  sprint: "el sprint",
  assignee: "el responsable",
  tags: "los tags",
  column: "el estado",
};

function show(field: string | null, value: unknown): string {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return "ninguno";
  if (typeof value === "object" && value && "label" in value) return String((value as { label: string }).label);
  if (Array.isArray(value)) return value.join(", ");
  if (field === "priority") return PRIORITY_META[value as Priority]?.label ?? String(value);
  if (field === "dueDate") return formatDate(String(value), "d MMM yyyy");
  if (field === "estimateHours") return formatHours(Number(value));
  return String(value);
}

type Entry = TaskDetail["activity"][number];

function describe(entry: Entry) {
  switch (entry.kind) {
    case "created":
      return "creó la tarea";
    case "deleted":
      return "borró la tarea";
    case "restored":
      return "restauró la tarea";
    case "moved":
      return (
        <>
          la movió de <b>{show("column", entry.oldValue)}</b> a <b>{show("column", entry.newValue)}</b>
        </>
      );
    case "attached":
      return (
        <>
          adjuntó <b>{show(null, entry.newValue)}</b>
        </>
      );
    case "detached":
      return (
        <>
          borró el adjunto <b>{show(null, entry.oldValue)}</b>
        </>
      );
    case "agent":
      return entry.field === "claimed" ? (
        <>
          tomó la tarea para el agente en <b>{show(null, entry.newValue)}</b>
        </>
      ) : (
        <>
          registró el <b>{show(null, entry.newValue)}</b> del agente
        </>
      );
    case "linked":
    case "unlinked":
      return (
        <>
          {entry.kind === "linked" ? "vinculó" : "desvinculó"} <b>{show(null, entry.newValue ?? entry.oldValue)}</b>
        </>
      );
    case "updated":
      if (entry.field === "descriptionMd") return "editó la descripción";
      if (entry.field === "title")
        return (
          <>
            cambió el título a <b>{show("title", entry.newValue)}</b>
          </>
        );
      return (
        <>
          cambió {FIELD_LABELS[entry.field ?? ""] ?? entry.field} de <b>{show(entry.field, entry.oldValue)}</b> a{" "}
          <b>{show(entry.field, entry.newValue)}</b>
        </>
      );
    default:
      return entry.kind;
  }
}

export function Activity({ task }: { task: TaskDetail }) {
  return (
    <ol className="space-y-3">
      {task.activity.map((entry) => {
        const actor =
          entry.actorType === "automation"
            ? `Automatización${entry.ruleName ? ` «${entry.ruleName}»` : ""}`
            : entry.actorType === "integration"
              ? "GitHub"
              : entry.actorType === "system"
                ? "Sistema"
                : (entry.userName ?? "Alguien");
        return (
          <li key={entry.id} className="flex gap-2 text-sm">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
            <p className="min-w-0 flex-1 text-muted-foreground">
              {entry.actorType === "automation" ? <Bot className="mr-1 inline size-3.5 text-brand" /> : null}
              {entry.actorType === "integration" ? <GitBranch className="mr-1 inline size-3.5" /> : null}
              <span className="font-medium text-foreground">{actor}</span>
              {entry.via ? <span className="ml-1 rounded bg-muted px-1 text-[10px]">vía {entry.via}</span> : null} {describe(entry)}
              <span className="ml-2 text-xs" title={formatDateTime(entry.createdAt)}>
                {timeAgo(entry.createdAt)}
              </span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
