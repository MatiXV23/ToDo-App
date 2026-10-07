"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { timeAgo } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

async function copy(text: string, message = "Copiado") {
  await navigator.clipboard.writeText(text);
  toast.success(message);
}

function CodeLine({ children }: { children: string }) {
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 pr-10 font-mono text-xs">{children}</pre>
      <Button
        size="icon-xs"
        variant="ghost"
        className="absolute top-1.5 right-1.5"
        aria-label="Copiar"
        onClick={() => copy(children)}
      >
        <Copy />
      </Button>
    </div>
  );
}

/** Tokens personales para usar ToDoApp desde Claude Code (MCP) u otras herramientas. */
export function TokensView({ appUrl }: { appUrl: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const tokens = useQuery(trpc.token.list.queryOptions());
  const [name, setName] = useState("Claude Code");
  const [external, setExternal] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries(trpc.token.pathFilter());
  const create = useMutation(trpc.token.create.mutationOptions({ onSuccess: (t) => (setCreated(t.token), refresh()) }));
  const revoke = useMutation(trpc.token.revoke.mutationOptions({ onSuccess: refresh }));
  const setTokenExternal = useMutation(
    trpc.token.setExternal.mutationOptions({ onSuccess: refresh, onError: (err) => toast.error(err.message) }),
  );
  const command = `claude mcp add --transport http todoapp ${appUrl}/api/mcp --header "Authorization: Bearer ${created ?? "<tu token>"}"`;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
      <div>
        <h1 className="text-xl font-semibold">Tokens de API</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Permiten que Claude Code vea, cree, mueva y comente tareas por MCP con tus mismos permisos. Tratalos como una
          contraseña.
        </p>
      </div>

      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-sm font-semibold">Nuevo token</h2>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name, external });
          }}
        >
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej. Claude Code en mi Mac)" />
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              Crear token
            </Button>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={external} onCheckedChange={(checked) => setExternal(checked === true)} />
            <span>
              Integración externa
              <span className="block text-muted-foreground">
                Para apps que cargan contenido de terceros, como reportes de usuarios. Las tareas que cree o modifique quedan
                pendientes de tu aprobación, y sin ella el agente no mergea solo sus PRs.
              </span>
            </span>
          </label>
        </form>
        {created ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Copialo ahora: no se vuelve a mostrar.</p>
            <CodeLine>{created}</CodeLine>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-sm font-semibold">Conectar Claude Code</h2>
        <p className="text-sm text-muted-foreground">En una terminal, con el token creado:</p>
        <CodeLine>{command}</CodeLine>
        <p className="text-sm text-muted-foreground">
          Después pedile cosas como “mostrame el tablero de TDA”, “creá una tarea urgente para revisar el deploy” o “mové TDA-12 a
          En revisión”.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-sm font-semibold">Tokens activos</h2>
        {tokens.data?.length ? (
          <ul className="divide-y rounded-lg border">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <KeyRound className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{t.prefix}…</span> · creado {timeAgo(t.createdAt)} ·{" "}
                    {t.lastUsedAt ? `usado ${timeAgo(t.lastUsedAt)}` : "sin uso"}
                  </p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Sus tareas esperan tu aprobación">
                  <Switch
                    size="sm"
                    checked={t.external}
                    disabled={setTokenExternal.isPending}
                    onCheckedChange={(checked) => setTokenExternal.mutate({ tokenId: t.id, external: checked })}
                  />
                  Externo
                </label>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Revocar ${t.name}`}
                  onClick={() => window.confirm(`¿Revocar "${t.name}"? Deja de funcionar al instante.`) && revoke.mutate({ tokenId: t.id })}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No tenés tokens activos.</p>
        )}
      </section>
    </div>
  );
}
