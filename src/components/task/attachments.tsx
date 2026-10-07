"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { timeAgo } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { TaskDetail } from "./types";

const MAX_BYTES = 10 * 1024 * 1024;
type Attachment = TaskDetail["attachments"][number];

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Imágenes de la tarea (evidencias, referencias). Se suben con botón, arrastrando o pegando. */
export function Attachments({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries(trpc.task.get.queryFilter({ taskId: task.id }));
    void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: task.projectId }));
  };
  const remove = useMutation(trpc.attachment.delete.mutationOptions({ onSuccess: () => (setViewing(null), refresh()) }));

  const upload = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    for (const file of images) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} supera los 10 MB`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const body = new FormData();
        body.append("file", file, file.name || "captura.png");
        const res = await fetch(`/api/tasks/${task.id}/attachments`, { method: "POST", body });
        if (!res.ok) toast.error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo subir la imagen");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    refresh();
  };

  // Pegar una captura (Cmd/Ctrl+V) mientras la tarea está abierta.
  const uploadRef = useRef(upload);
  useEffect(() => {
    uploadRef.current = upload;
  });
  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      void uploadRef.current(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canEdit]);

  if (!canEdit && task.attachments.length === 0) return null;

  return (
    <section
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setDragging(false);
        void upload([...e.dataTransfer.files]);
      }}
      className={cn("-m-2 rounded-lg p-2 transition-colors", dragging && "bg-brand/5 ring-2 ring-brand/40")}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          Adjuntos {task.attachments.length ? `· ${task.attachments.length}` : ""}
        </h3>
        {canEdit ? (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => inputRef.current?.click()}>
            <ImagePlus /> Agregar imagen
          </Button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
      {task.attachments.length || uploading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {task.attachments.map((a) => (
            <button
              key={a.id}
              onClick={() => setViewing(a)}
              className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
              title={a.fileName}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.fileName} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" />
            </button>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <div key={`up-${i}`} className="flex aspect-square items-center justify-center rounded-lg border border-dashed">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ))}
        </div>
      ) : canEdit ? (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground hover:bg-muted/40"
        >
          Arrastrá, pegá (⌘/Ctrl+V) o elegí imágenes para evidencias o referencias
        </button>
      ) : null}

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-h-[95dvh] gap-3 sm:max-w-4xl">
          {viewing ? (
            <>
              <DialogTitle className="truncate pr-8 text-sm">{viewing.fileName}</DialogTitle>
              <DialogDescription className="text-xs">
                {viewing.uploadedBy?.name ?? "Alguien"} · {timeAgo(viewing.createdAt)} · {formatSize(viewing.sizeBytes)}
              </DialogDescription>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={viewing.url} alt={viewing.fileName} className="max-h-[70dvh] w-full rounded-lg object-contain" />
              <div className="flex flex-wrap justify-end gap-2">
                {canEdit ? (
                  <Button
                    variant="ghost"
                    className="mr-auto text-destructive"
                    onClick={() => window.confirm("¿Borrar esta imagen?") && remove.mutate({ attachmentId: viewing.id })}
                  >
                    <Trash2 /> Borrar
                  </Button>
                ) : null}
                <Button variant="outline" asChild>
                  <a href={`${viewing.url}?download`}>
                    <Download /> Descargar
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href={viewing.url} target="_blank" rel="noreferrer">
                    <ExternalLink /> Abrir
                  </a>
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
