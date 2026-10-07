"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { ProjectInfo } from "@/components/project/project-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { agentRoutinePrompt } from "@/lib/agent-prompt";
import { timeAgo } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsCard } from "./settings-view";

const PR_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Merge automático pendiente", className: "bg-amber-100 text-amber-800" },
  waiting_review: { label: "Espera revisión", className: "bg-sky-100 text-sky-800" },
  merged: { label: "Mergeado", className: "bg-purple-100 text-purple-700" },
  closed: { label: "Cerrado", className: "bg-zinc-100 text-zinc-600" },
};

export function AgentSettings({ project }: { project: ProjectInfo }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canEdit = project.can.includes("project.update");
  const settings = useQuery(trpc.agent.settings.queryOptions({ projectId: project.id }));
  const tags = useQuery(trpc.tag.list.queryOptions({ projectId: project.id }));
  const github = useQuery(trpc.github.status.queryOptions({ projectId: project.id }));
  const [window_, setWindow] = useState<{ from: string; until: string } | null>(null);
  const update = useMutation(
    trpc.agent.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.agent.pathFilter());
        void queryClient.invalidateQueries(trpc.tag.pathFilter());
        void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: project.id }));
        toast.success("Agente actualizado");
      },
    }),
  );
  const s = settings.data;
  if (!s) return null;
  const from = window_?.from ?? s.mergeFrom;
  const until = window_?.until ?? s.mergeUntil;
  const tagName = tags.data?.find((t) => t.id === s.tagId)?.name ?? "IA";
  const save = (patch: Partial<{ enabled: boolean; tagId: string | null; mergeFrom: string; mergeUntil: string }>) =>
    update.mutate({
      projectId: project.id,
      enabled: s.enabled,
      tagId: s.tagId,
      mergeFrom: from,
      mergeUntil: until,
      ...patch,
    });
  const prompt = agentRoutinePrompt({ projectKey: project.key, tagName });

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Agente Claude"
        description="Una rutina de Claude Code toma las tareas con el tag elegido, las implementa en ramas y abre PRs."
      >
        <div className="space-y-5">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={s.enabled} disabled={!canEdit} onCheckedChange={(enabled) => save({ enabled })} />
            {s.enabled ? "Activado" : "Desactivado"}
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Tag que activa al agente</Label>
              <Select value={s.tagId ?? undefined} disabled={!canEdit} onValueChange={(tagId) => save({ tagId })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="IA (se crea al activar)" />
                </SelectTrigger>
                <SelectContent>
                  {tags.data?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="merge-from">Mergear PRs fáciles desde</Label>
              <Input id="merge-from" type="time" value={from} disabled={!canEdit} onChange={(e) => setWindow({ from: e.target.value, until })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="merge-until">hasta</Label>
              <Input id="merge-until" type="time" value={until} disabled={!canEdit} onChange={(e) => setWindow({ from, until: e.target.value })} />
            </div>
          </div>
          {canEdit && window_ && (window_.from !== s.mergeFrom || window_.until !== s.mergeUntil) ? (
            <Button size="sm" onClick={() => save({ mergeFrom: from, mergeUntil: until })}>
              Guardar ventana
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Zona horaria: {s.timezone}. Los PRs “fáciles” se mergean solos dentro de esa ventana cuando los checks están en verde. Los
            grandes esperan tu revisión.
          </p>
          {!github.data?.repos.length ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Conectá al menos un repositorio en Ajustes → GitHub para que el agente sepa dónde trabajar.
            </p>
          ) : null}
        </div>
      </SettingsCard>

      <SettingsCard title="Configurar la rutina" description="Se hace una sola vez desde Claude Code.">
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>
            Creá un token en{" "}
            <Link href="/settings/tokens" className="underline">
              Tokens de API
            </Link>{" "}
            (por ejemplo “Agente Claude”) y agregá el servidor MCP <span className="font-mono text-xs">todoapp</span> con ese token al
            entorno de la rutina.
          </li>
          <li>
            Creá una rutina programada en Claude Code (<span className="font-mono text-xs">/schedule</span>) sobre el repositorio, por
            ejemplo cada hora, con estas instrucciones:
            <div className="relative mt-2">
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 pr-10 text-xs whitespace-pre-wrap">{prompt}</pre>
              <Button
                size="icon-xs"
                variant="ghost"
                className="absolute top-2 right-2"
                aria-label="Copiar instrucciones"
                onClick={async () => {
                  await navigator.clipboard.writeText(prompt);
                  toast.success("Instrucciones copiadas");
                }}
              >
                <Copy />
              </Button>
            </div>
          </li>
          <li>Poné el tag “{tagName}” a las tareas que quieras delegar.</li>
        </ol>
      </SettingsCard>

      <SettingsCard title="PRs del agente">
        {s.pullRequests.length ? (
          <ul className="divide-y rounded-lg border">
            {s.pullRequests.map((pr) => {
              const meta = PR_STATUS[pr.status] ?? PR_STATUS.pending;
              return (
                <li key={pr.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <Bot className="size-4 text-muted-foreground" />
                  <a href={pr.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                    <span className="text-muted-foreground">{pr.repo}#{pr.number}</span> {pr.title}
                    <ExternalLink className="ml-1 inline size-3" />
                  </a>
                  <span className="rounded bg-muted px-1.5 text-[11px]">{pr.complexity === "easy" ? "fácil" : "grande"}</span>
                  <span className={cn("rounded px-1.5 text-[11px] font-medium", meta.className)}>{meta.label}</span>
                  {pr.lastReason ? (
                    <span className="w-full pl-6 text-xs text-muted-foreground">
                      {pr.lastReason}
                      {pr.lastCheckAt ? ` · ${timeAgo(pr.lastCheckAt)}` : ""}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no hay PRs del agente.</p>
        )}
      </SettingsCard>
    </div>
  );
}
