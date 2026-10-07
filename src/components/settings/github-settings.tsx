"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitBranch, Lock, Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ProjectInfo } from "@/components/project/project-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { SettingsCard } from "./settings-view";

const FLASH: Record<string, { text: string; error?: boolean }> = {
  connected: { text: "Listo: GitHub quedó vinculado. Elegí qué repositorios conectar." },
  no_installations: { text: "Tu usuario de GitHub no tiene acceso a ninguna instalación de la app. Instalala primero.", error: true },
  missing_code: {
    text: "GitHub no devolvió un código de autorización. Activá “Request user authorization (OAuth) during installation” en la GitHub App.",
    error: true,
  },
  invalid_state: { text: "La sesión de conexión expiró. Probá de nuevo.", error: true },
  not_configured: { text: "La GitHub App no está configurada en el servidor.", error: true },
  forbidden: { text: "Solo el dueño del proyecto puede conectar repositorios.", error: true },
  error: { text: "No se pudo completar la conexión con GitHub. Revisá los logs del servidor.", error: true },
};

export function GithubSettings({ project }: { project: ProjectInfo }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const flash = FLASH[params.get("github") ?? ""];
  const canConnect = project.can.includes("repo.connect");
  const status = useQuery(trpc.github.status.queryOptions({ projectId: project.id }));
  const hasInstallations = (status.data?.installations.length ?? 0) > 0;
  const available = useQuery({
    ...trpc.github.availableRepos.queryOptions({ projectId: project.id }),
    enabled: canConnect && hasInstallations && !!status.data?.configured,
  });
  const [filter, setFilter] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries(trpc.github.pathFilter());
  };
  const connect = useMutation(trpc.github.connectRepo.mutationOptions({ onSuccess: refresh }));
  const disconnect = useMutation(trpc.github.disconnectRepo.mutationOptions({ onSuccess: refresh }));

  if (status.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  const data = status.data;
  if (!data) return null;
  const connectHref = (mode: "install" | "link") => `/api/integrations/github/connect?project=${project.key}&mode=${mode}`;
  const repos = (available.data ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-6">
      {flash ? (
        <p className={`rounded-lg border px-3 py-2 text-sm ${flash.error ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-green-200 bg-green-50 text-green-800"}`}>
          {flash.text}
        </p>
      ) : null}

      {!data.configured ? (
        <SettingsCard title="GitHub no está configurado" description="Falta crear la GitHub App y completar las variables GITHUB_* del .env.">
          <p className="text-sm text-muted-foreground">
            Los pasos están en el README, sección “Integración con GitHub”. Después de completar el .env, reiniciá el servidor.
          </p>
        </SettingsCard>
      ) : null}

      <SettingsCard
        title="Repositorios conectados"
        description="Las ramas, commits y PRs que mencionen la clave de una tarea (por ejemplo TDA-12) se vinculan solos."
      >
        {data.repos.length ? (
          <ul className="divide-y rounded-lg border">
            {data.repos.map((repo) => (
              <li key={repo.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <GitBranch className="size-4 text-muted-foreground" />
                <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                  {repo.fullName}
                </a>
                <span className="text-xs text-muted-foreground">{repo.defaultBranch}</span>
                {canConnect ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Desconectar ${repo.fullName}`}
                    onClick={() =>
                      window.confirm(`¿Desconectar ${repo.fullName}? Se borran los vínculos de sus ramas y PRs.`) &&
                      disconnect.mutate({ projectRepositoryId: repo.id })
                    }
                  >
                    <X />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Ningún repositorio conectado todavía.</p>
        )}
      </SettingsCard>

      {canConnect && data.configured ? (
        <SettingsCard title="Conectar con GitHub" description="Instalá la GitHub App en tu cuenta u organización y elegí los repositorios.">
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={connectHref("install")}>
                <ExternalLink /> Instalar GitHub App
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={connectHref("link")}>Ya la instalé: vincular mi cuenta</a>
            </Button>
          </div>
          {hasInstallations ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Cuentas vinculadas: {data.installations.map((i) => i.accountLogin).join(", ")}
            </p>
          ) : null}

          {hasInstallations ? (
            <div className="mt-5">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar repositorios" className="h-8 pl-8" />
              </div>
              {available.isLoading ? (
                <Skeleton className="h-24 rounded-lg" />
              ) : repos.length ? (
                <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
                  {repos.map((repo) => (
                    <li key={`${repo.installationId}:${repo.externalId}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                      {repo.private ? <Lock className="size-3.5 text-muted-foreground" /> : <GitBranch className="size-3.5 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 truncate">{repo.fullName}</span>
                      {repo.connected ? (
                        <span className="text-xs text-muted-foreground">Conectado</span>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={connect.isPending}
                          onClick={() =>
                            connect.mutate({ projectId: project.id, installationId: repo.installationId, externalRepoId: repo.externalId })
                          }
                        >
                          Conectar
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No hay repositorios disponibles en las instalaciones vinculadas.</p>
              )}
            </div>
          ) : null}
        </SettingsCard>
      ) : null}
    </div>
  );
}
