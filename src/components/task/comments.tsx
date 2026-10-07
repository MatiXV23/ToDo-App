"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/common/markdown";
import { UserAvatar } from "@/components/common/user-avatar";
import { useCurrentUser } from "@/components/shell/current-user";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { TaskDetail } from "./types";

export function Comments({ task, canComment, canModerate }: { task: TaskDetail; canComment: boolean; canModerate: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const invalidate = () => {
    void queryClient.invalidateQueries(trpc.task.get.queryFilter({ taskId: task.id }));
    void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: task.projectId }));
  };
  const add = useMutation(trpc.comment.add.mutationOptions({ onSuccess: () => (setBody(""), invalidate()) }));
  const update = useMutation(trpc.comment.update.mutationOptions({ onSuccess: () => (setEditing(null), invalidate()) }));
  const remove = useMutation(trpc.comment.delete.mutationOptions({ onSuccess: invalidate }));

  const submit = () => body.trim() && add.mutate({ taskId: task.id, bodyMd: body });

  return (
    <div className="space-y-4">
      {task.comments.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay comentarios.</p> : null}
      {task.comments.map((c) => {
        const mine = c.author?.id === me.id;
        const isAutomation = c.source === "automation";
        return (
          <div key={c.id} className="flex gap-3">
            {isAutomation ? (
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                <Bot className="size-4" />
              </div>
            ) : (
              <UserAvatar user={c.author} className="size-7" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">
                  {isAutomation ? `Automatización${c.ruleName ? ` · ${c.ruleName}` : ""}` : (c.author?.name ?? "Usuario eliminado")}
                </span>
                <span className="text-muted-foreground" title={formatDateTime(c.createdAt)}>
                  {timeAgo(c.createdAt)}
                  {c.editedAt ? " · editado" : ""}
                </span>
                {(mine && canComment) || canModerate ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Opciones del comentario">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {mine && canComment ? (
                        <DropdownMenuItem onSelect={() => setEditing({ id: c.id, body: c.bodyMd })}>Editar</DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate({ commentId: c.id })}>
                        Borrar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              {editing?.id === c.id ? (
                <div className="mt-1 space-y-2">
                  <Textarea autoFocus value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancelar
                    </Button>
                    <Button size="sm" onClick={() => update.mutate({ commentId: c.id, bodyMd: editing.body })}>
                      Guardar
                    </Button>
                  </div>
                </div>
              ) : (
                <Markdown className="mt-0.5">{c.bodyMd}</Markdown>
              )}
            </div>
          </div>
        );
      })}
      {canComment ? (
        <div className="flex gap-3">
          <UserAvatar user={me} className="size-7" />
          <div className="flex-1 space-y-2">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Escribí un comentario… (Markdown)"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
            {body.trim() ? (
              <div className="flex justify-end">
                <Button size="sm" disabled={add.isPending} onClick={submit}>
                  Comentar
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
