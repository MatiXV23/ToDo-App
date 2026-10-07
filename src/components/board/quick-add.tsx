"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/lib/trpc";

/** Alta rápida al pie de una columna: Enter crea y deja el campo listo para la siguiente. */
export function QuickAdd({ projectId, columnId, sprintId }: { projectId: string; columnId: string; sprintId: string | null }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const create = useMutation(
    trpc.task.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId })),
    }),
  );

  function submit() {
    const value = title.trim();
    if (!value) return;
    create.mutate({ projectId, columnId, sprintId, title: value, position: "bottom" });
    setTitle("");
    inputRef.current?.focus();
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus /> Crear tarea
      </Button>
    );
  }
  return (
    <div className="rounded-lg border bg-card p-2 shadow-xs">
      <Textarea
        ref={inputRef}
        autoFocus
        rows={2}
        value={title}
        placeholder="¿Qué hay que hacer?"
        className="min-h-0 resize-none border-0 p-0 text-sm shadow-none focus-visible:ring-0"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Enter para crear · Esc para cerrar</span>
        <Button size="xs" onMouseDown={(e) => e.preventDefault()} onClick={submit} disabled={!title.trim()}>
          Crear
        </Button>
      </div>
    </div>
  );
}
