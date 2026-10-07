"use client";

import { Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PALETTE } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label="Elegir color"
          className="size-6 shrink-0 rounded-md border border-black/10"
          style={{ backgroundColor: value }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-6 gap-1.5">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              onClick={() => onChange(color)}
              className={cn("flex size-6 items-center justify-center rounded-md text-white")}
              style={{ backgroundColor: color }}
            >
              {color === value ? <Check className="size-3.5" /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
