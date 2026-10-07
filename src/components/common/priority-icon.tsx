import { ChevronDown, ChevronsUp, ChevronUp, Equal } from "lucide-react";
import { type Priority, PRIORITY_META } from "@/lib/domain";
import { cn } from "@/lib/utils";

const ICONS = { urgent: ChevronsUp, high: ChevronUp, medium: Equal, low: ChevronDown } as const;

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const Icon = ICONS[priority];
  return (
    <Icon
      aria-label={`Prioridad ${PRIORITY_META[priority].label}`}
      className={cn("size-4 shrink-0", PRIORITY_META[priority].className, className)}
    />
  );
}
