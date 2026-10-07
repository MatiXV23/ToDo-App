"use client";

import { useState } from "react";
import { Markdown } from "@/components/common/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Descripción en Markdown: se lee renderizada y se edita en el lugar. */
export function DescriptionEditor({
  value,
  onSave,
  disabled,
  toolbar,
  editing: editingProp,
  onEditingChange,
}: {
  value: string;
  onSave: (value: string) => void;
  disabled?: boolean;
  /** Acciones extra (IA) que se muestran junto al título de la sección. */
  toolbar?: React.ReactNode;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editingState, setEditingState] = useState(false);
  const editing = editingProp ?? editingState;
  const [draft, setDraft] = useState(value);
  const setEditing = (v: boolean) => {
    if (v) setDraft(value);
    setEditingState(v);
    onEditingChange?.(v);
  };
  const [preview, setPreview] = useState(false);

  const save = () => {
    if (draft !== value) onSave(draft);
    setEditing(false);
    setPreview(false);
  };

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Descripción</h3>
        <div className="ml-auto flex items-center gap-1">{toolbar}</div>
      </div>
      {editing ? (
        <div className="rounded-lg border">
          <div className="flex gap-1 border-b px-2 py-1">
            <Button size="xs" variant={preview ? "ghost" : "secondary"} onClick={() => setPreview(false)}>
              Escribir
            </Button>
            <Button size="xs" variant={preview ? "secondary" : "ghost"} onClick={() => setPreview(true)}>
              Vista previa
            </Button>
          </div>
          {preview ? (
            <div className="min-h-32 px-3 py-2">
              {draft.trim() ? <Markdown>{draft}</Markdown> : <p className="text-sm text-muted-foreground">Nada para mostrar</p>}
            </div>
          ) : (
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
                if (e.key === "Escape") {
                  setDraft(value);
                  setEditing(false);
                }
              }}
              rows={10}
              className="min-h-40 rounded-none border-0 font-mono text-[13px] shadow-none focus-visible:ring-0"
              placeholder="Markdown: **negrita**, listas, `código`, [enlaces](https://…)"
            />
          )}
          <div className="flex items-center justify-end gap-2 border-t px-2 py-1.5">
            <span className="mr-auto text-[11px] text-muted-foreground">⌘/Ctrl + Enter para guardar</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(value);
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={save}>
              Guardar
            </Button>
          </div>
        </div>
      ) : (
        <div
          role={disabled ? undefined : "button"}
          tabIndex={disabled ? undefined : 0}
          onClick={() => !disabled && setEditing(true)}
          onKeyDown={(e) => !disabled && e.key === "Enter" && setEditing(true)}
          className={cn("-mx-2 rounded-md px-2 py-1", !disabled && "cursor-text hover:bg-muted/50")}
        >
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">{disabled ? "Sin descripción" : "Agregar una descripción…"}</p>
          )}
        </div>
      )}
    </section>
  );
}
