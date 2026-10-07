"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useCan, useProject } from "@/components/project/project-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { branchNameFor, type PrState, PR_STATE_META } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { TaskDetail } from "./types";

type VcsLink = TaskDetail["links"][number];

function BranchStatusLine({ link, mergedPr }: { link: VcsLink; mergedPr: boolean }) {
  const trpc = useTRPC();
  const status = useQuery({
    ...trpc.github.branchStatus.queryOptions({ linkId: link.id }),
    enabled: link.state === "active" && !mergedPr,
    staleTime: 60_000,
  });
  if (mergedPr) return <span className="rounded bg-purple-100 px-1.5 text-[11px] text-purple-700">Mergeada</span>;
  if (link.state === "deleted") return <span className="rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-600">Borrada</span>;
  if (!status.data) return <span className="rounded bg-green-100 px-1.5 text-[11px] text-green-700">Activa</span>;
  if (!status.data.exists) return <span className="rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-600">No encontrada</span>;
  return (
    <span className="text-[11px] text-muted-foreground">
      {status.data.aheadBy} adelante · {status.data.behindBy} atrás
    </span>
  );
}

export function VcsPanel({ task }: { task: TaskDetail }) {
  const project = useProject();
  const can = useCan();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useQuery(trpc.github.status.queryOptions({ projectId: project.id }));
  const [creating, setCreating] = useState(false);
  const unlink = useMutation(
    trpc.github.unlink.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.task.get.queryFilter({ taskId: task.id })),
    }),
  );

  const prs = task.links.filter((l) => l.kind === "pull_request");
  const branches = task.links.filter((l) => l.kind === "branch");
  const commits = task.links.filter((l) => l.kind === "commit").slice(0, 10);
  const mergedBranches = new Set(
    prs.filter((p) => p.state === "merged").map((p) => `${p.repository.id}:${(p.data as { headBranch?: string }).headBranch}`),
  );
  const repos = status.data?.repos ?? [];
  const canLink = can("repo.link");

  const unlinkButton = (link: VcsLink) =>
    canLink ? (
      <Button variant="ghost" size="icon-xs" aria-label="Desvincular" className="opacity-0 group-hover:opacity-100" onClick={() => unlink.mutate({ linkId: link.id })}>
        <X />
      </Button>
    ) : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {repos.length ? (
          <p className="text-xs text-muted-foreground">
            Se vinculan solos las ramas, commits y PRs que mencionen <span className="font-mono">{task.key}</span>.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No hay repositorios conectados.{" "}
            {can("repo.connect") ? (
              <Link href={`/p/${project.key}/settings?tab=github`} className="underline">
                Conectar en Ajustes
              </Link>
            ) : null}
          </p>
        )}
        {canLink && repos.length ? (
          <Button size="xs" variant="outline" className="ml-auto shrink-0" onClick={() => setCreating(true)}>
            <Plus /> Crear rama
          </Button>
        ) : null}
      </div>

      {prs.length ? (
        <section>
          <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Pull requests</h4>
          <ul className="divide-y rounded-lg border">
            {prs.map((pr) => {
              const meta = PR_STATE_META[pr.state as PrState] ?? PR_STATE_META.open;
              return (
                <li key={pr.id} className="group flex items-center gap-2 px-3 py-2 text-sm">
                  {pr.state === "merged" ? <GitMerge className="size-4 text-purple-600" /> : <GitPullRequest className="size-4 text-muted-foreground" />}
                  <a href={pr.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                    <span className="text-muted-foreground">#{pr.externalId}</span> {pr.title}
                  </a>
                  <span className={cn("rounded px-1.5 text-[11px] font-medium", meta.className)}>{meta.label}</span>
                  {unlinkButton(pr)}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {branches.length ? (
        <section>
          <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Ramas</h4>
          <ul className="divide-y rounded-lg border">
            {branches.map((b) => (
              <li key={b.id} className="group flex items-center gap-2 px-3 py-2 text-sm">
                <GitBranch className="size-4 text-muted-foreground" />
                <a href={b.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs hover:underline">
                  {b.externalId}
                </a>
                <span className="hidden text-[11px] text-muted-foreground sm:inline">{b.repository.fullName}</span>
                <BranchStatusLine link={b} mergedPr={mergedBranches.has(`${b.repository.id}:${b.externalId}`)} />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Copiar comando"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={async () => {
                    await navigator.clipboard.writeText(`git fetch origin && git checkout ${b.externalId}`);
                    toast.success("Comando copiado");
                  }}
                >
                  <Copy />
                </Button>
                {unlinkButton(b)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {commits.length ? (
        <section>
          <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Commits recientes</h4>
          <ul className="divide-y rounded-lg border">
            {commits.map((c) => (
              <li key={c.id} className="group flex items-center gap-2 px-3 py-2 text-sm">
                <GitCommitHorizontal className="size-4 text-muted-foreground" />
                <a href={c.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-muted-foreground hover:underline">
                  {c.externalId.slice(0, 7)}
                </a>
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="text-[11px] text-muted-foreground">{timeAgo(c.updatedAt)}</span>
                {unlinkButton(c)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {repos.length && task.links.length === 0 ? <p className="text-sm text-muted-foreground">Sin ramas ni PRs vinculados.</p> : null}

      <CreateBranchDialog open={creating} onOpenChange={setCreating} task={task} repos={repos} />
    </div>
  );
}

function CreateBranchDialog({
  open,
  onOpenChange,
  task,
  repos,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task: TaskDetail;
  repos: { id: string; fullName: string; defaultBranch: string }[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [repoId, setRepoId] = useState(repos[0]?.id ?? "");
  const [branch, setBranch] = useState(() => branchNameFor(task.projectKey, task.number, task.title));
  const repo = repos.find((r) => r.id === repoId) ?? repos[0];
  const [base, setBase] = useState("");
  const create = useMutation(
    trpc.github.createBranch.mutationOptions({
      onSuccess: async (result) => {
        void queryClient.invalidateQueries(trpc.task.get.queryFilter({ taskId: task.id }));
        await navigator.clipboard.writeText(`git fetch origin && git checkout ${result.branch}`).catch(() => {});
        toast.success(result.created ? "Rama creada. Comando para cambiarte copiado." : "La rama ya existía: quedó vinculada.");
        onOpenChange(false);
      },
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear rama para {task.key}</DialogTitle>
          <DialogDescription>Se crea en GitHub desde la rama base y queda vinculada a la tarea.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {repos.length > 1 ? (
            <div className="space-y-1.5">
              <Label>Repositorio</Label>
              <Select value={repo?.id} onValueChange={setRepoId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {repos.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="branch-name">Nombre</Label>
            <Input id="branch-name" value={branch} onChange={(e) => setBranch(e.target.value)} className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch-base">Rama base</Label>
            <Input id="branch-base" value={base} placeholder={repo?.defaultBranch} onChange={(e) => setBase(e.target.value)} className="font-mono text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!repo || !branch.trim() || create.isPending}
            onClick={() => repo && create.mutate({ taskId: task.id, projectRepositoryId: repo.id, branch, baseBranch: base || undefined })}
          >
            Crear rama
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
