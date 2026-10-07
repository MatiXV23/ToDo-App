"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { forwardRef, useState } from "react";
import { TagChip } from "@/components/common/chips";
import { OptionPicker } from "@/components/common/option-picker";
import { PriorityIcon } from "@/components/common/priority-icon";
import { UserAvatar } from "@/components/common/user-avatar";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { PALETTE, type Priority, PRIORITIES, PRIORITY_META } from "@/lib/domain";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { Board } from "@/components/board/filters";

/** Botón con aspecto de campo editable; se usa como disparador de los selectores. */
export const FieldButton = forwardRef<HTMLButtonElement, React.ComponentProps<"button"> & { placeholder?: boolean }>(
  function FieldButton({ className, children, placeholder, disabled, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent",
          placeholder && "text-muted-foreground",
          className,
        )}
        {...props}
      >
        {children}
        {!disabled ? <ChevronDown className="ml-auto size-3.5 shrink-0 opacity-0 group-hover/field:opacity-50" /> : null}
      </button>
    );
  },
);

type Lookups = Pick<Board, "columns" | "members" | "epics" | "tags" | "sprints"> & { projectId: string };

export function ColumnField({
  board,
  value,
  onChange,
  disabled,
}: {
  board: Lookups;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const column = board.columns.find((c) => c.id === value);
  return (
    <OptionPicker
      disabled={disabled}
      options={board.columns.map((c) => ({ value: c.id, label: c.name }))}
      selected={[value]}
      onSelect={onChange}
    >
      <FieldButton disabled={disabled}>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{column?.name ?? "—"}</span>
      </FieldButton>
    </OptionPicker>
  );
}

export function AssigneeField({
  board,
  value,
  onChange,
  disabled,
}: {
  board: Lookups;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const member = board.members.find((m) => m.id === value);
  return (
    <OptionPicker
      disabled={disabled}
      options={[
        { value: "none", label: "Sin responsable", icon: <UserAvatar user={null} className="size-5" /> },
        ...board.members.map((m) => ({
          value: m.id,
          label: m.name,
          hint: m.email,
          icon: <UserAvatar user={m} className="size-5" />,
        })),
      ]}
      selected={[value ?? "none"]}
      onSelect={(v) => onChange(v === "none" ? null : v)}
    >
      <FieldButton disabled={disabled} placeholder={!member}>
        <UserAvatar user={member} className="size-5" />
        <span className="truncate">{member?.name ?? "Sin responsable"}</span>
      </FieldButton>
    </OptionPicker>
  );
}

export function PriorityField({
  value,
  onChange,
  disabled,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
  disabled?: boolean;
}) {
  return (
    <OptionPicker
      disabled={disabled}
      options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label, icon: <PriorityIcon priority={p} /> }))}
      selected={[value]}
      onSelect={(v) => onChange(v as Priority)}
    >
      <FieldButton disabled={disabled}>
        <PriorityIcon priority={value} />
        {PRIORITY_META[value].label}
      </FieldButton>
    </OptionPicker>
  );
}

export function EpicField({
  board,
  value,
  onChange,
  disabled,
}: {
  board: Lookups;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const epic = board.epics.find((e) => e.id === value);
  return (
    <OptionPicker
      disabled={disabled}
      options={[
        { value: "none", label: "Sin epic" },
        ...board.epics
          .filter((e) => e.status === "open" || e.id === value)
          .map((e) => ({
            value: e.id,
            label: e.title,
            icon: <span className="size-2.5 rounded-sm" style={{ backgroundColor: e.color }} />,
          })),
      ]}
      selected={[value ?? "none"]}
      onSelect={(v) => onChange(v === "none" ? null : v)}
    >
      <FieldButton disabled={disabled} placeholder={!epic}>
        {epic ? <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: epic.color }} /> : null}
        <span className="truncate">{epic?.title ?? "Sin epic"}</span>
      </FieldButton>
    </OptionPicker>
  );
}

export function SprintField({
  board,
  value,
  onChange,
  disabled,
}: {
  board: Lookups;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const sprint = board.sprints.find((s) => s.id === value);
  return (
    <OptionPicker
      disabled={disabled}
      options={[
        { value: "none", label: "Backlog" },
        ...board.sprints.map((s) => ({ value: s.id, label: s.name, hint: s.status === "active" ? "activo" : undefined })),
      ]}
      selected={[value ?? "none"]}
      onSelect={(v) => onChange(v === "none" ? null : v)}
    >
      <FieldButton disabled={disabled} placeholder={!sprint}>
        <span className="truncate">{sprint?.name ?? (value ? "Sprint cerrado" : "Backlog")}</span>
      </FieldButton>
    </OptionPicker>
  );
}

export function TagsField({
  board,
  value,
  onChange,
  disabled,
  canCreate,
  emptyLabel = "Sin tags",
}: {
  board: Lookups;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  canCreate?: boolean;
  emptyLabel?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const createTag = useMutation(
    trpc.tag.create.mutationOptions({
      onSuccess: (tag) => {
        onChange([...value, tag.id]);
        void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: board.projectId }));
      },
    }),
  );
  const selected = board.tags.filter((t) => value.includes(t.id));
  return (
    <OptionPicker
      multiple
      disabled={disabled}
      placeholder="Buscar o crear tag…"
      emptyText={canCreate ? "Escribí para crear un tag" : "Sin tags"}
      options={board.tags.map((t) => ({
        value: t.id,
        label: t.name,
        icon: <span className="size-2.5 rounded-full" style={{ backgroundColor: t.color }} />,
      }))}
      selected={value}
      onSelect={(id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])}
      footer={(search) =>
        canCreate && search.trim() && !board.tags.some((t) => t.name.toLowerCase() === search.trim().toLowerCase()) ? (
          <CommandGroup forceMount>
            <CommandItem
              forceMount
              value={`__create ${search}`}
              onSelect={() =>
                createTag.mutate({
                  projectId: board.projectId,
                  name: search.trim(),
                  color: PALETTE[board.tags.length % PALETTE.length],
                })
              }
            >
              <Plus /> Crear tag “{search.trim()}”
            </CommandItem>
          </CommandGroup>
        ) : null
      }
    >
      <FieldButton disabled={disabled} placeholder={selected.length === 0} className="h-auto min-h-8 py-1">
        {selected.length ? (
          <span className="flex flex-wrap gap-1">
            {selected.map((t) => (
              <TagChip key={t.id} tag={t} />
            ))}
          </span>
        ) : (
          emptyLabel
        )}
      </FieldButton>
    </OptionPicker>
  );
}

export function DateField({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <Input
      type="date"
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-8 border-transparent px-2 shadow-none hover:bg-muted focus-visible:bg-background disabled:opacity-100"
    />
  );
}

/** Estimación en horas. Guarda al salir del campo o con Enter. */
export function HoursField({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (hours: number | null) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value?.toString() ?? "");
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value?.toString() ?? "");
  }
  const commit = () => {
    const parsed = draft.trim() === "" ? null : Number(draft.replace(",", "."));
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
      setDraft(value?.toString() ?? "");
      return;
    }
    if (parsed !== value) onChange(parsed);
  };
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 border-transparent px-2 pr-8 shadow-none hover:bg-muted focus-visible:bg-background disabled:opacity-100"
      />
      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">h</span>
    </div>
  );
}
