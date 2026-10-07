import { CalendarClock } from "lucide-react";
import { dueStatus, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const STYLES = {
  overdue: "text-red-600",
  today: "text-orange-600",
  soon: "text-amber-600",
  later: "text-muted-foreground",
  done: "text-muted-foreground line-through",
} as const;

export function DueDate({ date, done, className }: { date: string; done?: boolean; className?: string }) {
  const status = dueStatus(date, done);
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px]", STYLES[status], className)}>
      <CalendarClock className="size-3" />
      {status === "today" ? "Hoy" : formatDate(date)}
    </span>
  );
}
