import { cn } from "@/lib/utils";

export function TagChip({ tag, className }: { tag: { name: string; color: string }; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-32 items-center gap-1 truncate rounded-md border px-1.5 py-px text-[11px] leading-4 text-foreground/80",
        className,
      )}
      style={{ borderColor: `${tag.color}55`, backgroundColor: `${tag.color}14` }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

export function EpicChip({ epic, className }: { epic: { title: string; color: string }; className?: string }) {
  return (
    <span
      className={cn("inline-flex max-w-40 items-center truncate rounded px-1.5 py-px text-[11px] font-medium leading-4", className)}
      style={{ backgroundColor: `${epic.color}22`, color: epic.color }}
    >
      <span className="truncate">{epic.title}</span>
    </span>
  );
}

export function KeyBadge({ value, className }: { value: string; className?: string }) {
  return <span className={cn("font-mono text-[11px] text-muted-foreground", className)}>{value}</span>;
}
