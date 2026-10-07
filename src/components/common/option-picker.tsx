"use client";

import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type PickerOption = { value: string; label: string; icon?: React.ReactNode; hint?: string };

type Props = {
  options: PickerOption[];
  selected: string[];
  onSelect: (value: string) => void;
  multiple?: boolean;
  children: React.ReactNode;
  placeholder?: string;
  emptyText?: string;
  align?: "start" | "end" | "center";
  disabled?: boolean;
  /** Contenido extra al final (ej. "crear tag"). Recibe el texto buscado. */
  footer?: (search: string, close: () => void) => React.ReactNode;
};

/** Selector con búsqueda, para filtros (múltiple) y campos (simple). */
export function OptionPicker({
  options,
  selected,
  onSelect,
  multiple,
  children,
  placeholder = "Buscar…",
  emptyText = "Sin resultados",
  align = "start",
  disabled,
  footer,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const close = () => setOpen(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align={align}>
        <Command>
          <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.hint ?? ""} ${option.value}`}
                  data-checked={selected.includes(option.value)}
                  onSelect={() => {
                    onSelect(option.value);
                    if (!multiple) close();
                  }}
                >
                  {option.icon}
                  <span className="truncate">{option.label}</span>
                  {option.hint ? <span className="truncate text-xs text-muted-foreground">{option.hint}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {footer ? footer(search, close) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
