"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { OptionPicker, type PickerOption } from "@/components/common/option-picker";
import { PriorityIcon } from "@/components/common/priority-icon";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PRIORITIES, PRIORITY_META } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { activeFilterCount, type Board, type BoardFilters, EMPTY_FILTERS } from "./filters";

function toggle<T extends string>(list: T[], value: T) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function FilterButton({ label, count, ...props }: { label: string; count: number } & React.ComponentProps<"button">) {
  return (
    <Button variant="outline" size="sm" className={cn(count > 0 && "border-foreground/30 bg-muted")} {...props}>
      {label}
      {count > 0 ? <span className="rounded bg-foreground px-1 text-[10px] text-background">{count}</span> : null}
      <ChevronDown className="opacity-50" />
    </Button>
  );
}

export function BoardToolbar({
  board,
  filters,
  onChange,
  actions,
}: {
  board: Board;
  filters: BoardFilters;
  onChange: (f: BoardFilters) => void;
  actions?: React.ReactNode;
}) {
  const assigneeOptions: PickerOption[] = [
    { value: "none", label: "Sin responsable", icon: <UserAvatar user={null} className="size-5" /> },
    ...board.members.map((m) => ({ value: m.id, label: m.name, icon: <UserAvatar user={m} className="size-5" /> })),
  ];
  const epicOptions: PickerOption[] = [
    { value: "none", label: "Sin epic" },
    ...board.epics.map((e) => ({
      value: e.id,
      label: e.title,
      icon: <span className="size-2.5 rounded-sm" style={{ backgroundColor: e.color }} />,
    })),
  ];
  const tagOptions: PickerOption[] = board.tags.map((t) => ({
    value: t.id,
    label: t.name,
    icon: <span className="size-2.5 rounded-full" style={{ backgroundColor: t.color }} />,
  }));
  const priorityOptions: PickerOption[] = PRIORITIES.map((p) => ({
    value: p,
    label: PRIORITY_META[p].label,
    icon: <PriorityIcon priority={p} />,
  }));
  const count = activeFilterCount(filters);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 md:px-6">
      <div className="relative w-full sm:w-56">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Buscar por título o clave"
          className="h-8 pl-8"
        />
      </div>
      <OptionPicker
        multiple
        options={assigneeOptions}
        selected={filters.assignees}
        onSelect={(v) => onChange({ ...filters, assignees: toggle(filters.assignees, v) })}
      >
        <FilterButton label="Responsable" count={filters.assignees.length} />
      </OptionPicker>
      <OptionPicker
        multiple
        options={epicOptions}
        selected={filters.epics}
        onSelect={(v) => onChange({ ...filters, epics: toggle(filters.epics, v) })}
      >
        <FilterButton label="Epic" count={filters.epics.length} />
      </OptionPicker>
      <OptionPicker
        multiple
        options={tagOptions}
        selected={filters.tags}
        emptyText="No hay tags"
        onSelect={(v) => onChange({ ...filters, tags: toggle(filters.tags, v) })}
      >
        <FilterButton label="Tag" count={filters.tags.length} />
      </OptionPicker>
      <OptionPicker
        multiple
        options={priorityOptions}
        selected={filters.priorities}
        onSelect={(v) =>
          onChange({ ...filters, priorities: toggle(filters.priorities, v as BoardFilters["priorities"][number]) })
        }
      >
        <FilterButton label="Prioridad" count={filters.priorities.length} />
      </OptionPicker>
      {count > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => onChange({ ...EMPTY_FILTERS, showSubtasks: filters.showSubtasks })}>
          <X /> Limpiar
        </Button>
      ) : null}
      <label className="ml-1 flex items-center gap-2 text-sm text-muted-foreground">
        <Switch
          size="sm"
          checked={filters.showSubtasks}
          onCheckedChange={(checked) => onChange({ ...filters, showSubtasks: checked })}
        />
        Subtareas
      </label>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}
