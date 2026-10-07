"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { type RouterOutputs, useTRPC } from "@/lib/trpc";

type AccessList = RouterOutputs["access"]["list"];
type Person = { email: string; name: string | null; image: string | null };

function PersonRow({ person, meta, children }: { person: Person; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <UserAvatar user={{ name: person.name ?? person.email, image: person.image }} className="size-8" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{person.name ?? person.email}</p>
        <p className="truncate text-xs text-muted-foreground">
          {person.name ? person.email : null}
          {person.name && meta ? " · " : null}
          {meta}
        </p>
      </div>
      {children ? <div className="flex shrink-0 gap-2">{children}</div> : null}
    </li>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Pantalla del admin: quién puede entrar a la app con Google. */
export function AccessView() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const list = useQuery(trpc.access.list.queryOptions());
  const [email, setEmail] = useState("");
  const decide = useMutation(
    trpc.access.decide.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.access.pathFilter()),
    }),
  );
  const grant = (target: string) => decide.mutate({ email: target, approve: true });
  const deny = (target: string) => decide.mutate({ email: target, approve: false });

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 md:px-8">
      <div>
        <h1 className="text-xl font-semibold">Acceso a la app</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Solo entran con Google las personas que apruebes. Si alguien intenta entrar sin acceso, aparece acá como
          solicitud y te llega un aviso al buzón. Cuando invitás a alguien a un proyecto, queda aprobado.
        </p>
      </div>

      <Section title="Dar acceso" description="Aprobá un email por adelantado, antes de que intente entrar.">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const target = email.trim();
            decide.mutate(
              { email: target, approve: true },
              { onSuccess: () => (toast.success(`${target} ya puede entrar`), setEmail("")) },
            );
          }}
        >
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="persona@gmail.com" />
          <Button type="submit" disabled={!email.trim() || decide.isPending}>
            <UserPlus /> Dar acceso
          </Button>
        </form>
      </Section>

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : list.data ? (
        <Lists data={list.data} grant={grant} deny={deny} busy={decide.isPending} />
      ) : null}
    </div>
  );
}

function Lists({
  data,
  grant,
  deny,
  busy,
}: {
  data: AccessList;
  grant: (email: string) => void;
  deny: (email: string) => void;
  busy: boolean;
}) {
  return (
    <>
      <Section title={`Solicitudes pendientes${data.pending.length ? ` (${data.pending.length})` : ""}`}>
        {data.pending.length ? (
          <ul className="divide-y rounded-xl border">
            {data.pending.map((p) => (
              <PersonRow
                key={p.email}
                person={p}
                meta={
                  <>
                    {p.requestedAt ? `pidió acceso ${timeAgo(p.requestedAt)}` : "pidió acceso"}
                    {p.invitations.map((i) => (
                      <span key={i.project}>
                        {" · "}invitado a {i.project} por {i.invitedBy}
                      </span>
                    ))}
                  </>
                }
              >
                <Button variant="outline" size="sm" disabled={busy} onClick={() => deny(p.email)}>
                  <X /> Rechazar
                </Button>
                <Button size="sm" disabled={busy} onClick={() => grant(p.email)}>
                  <Check /> Aprobar
                </Button>
              </PersonRow>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No hay solicitudes pendientes.
          </p>
        )}
      </Section>

      <Section title={`Con acceso (${data.admins.length + data.approved.length})`}>
        <ul className="divide-y rounded-xl border">
          {data.admins.map((a) => (
            <PersonRow key={a.email} person={a} meta="Administrador">
              <ShieldCheck className="size-4 text-brand" aria-label="Administrador" />
            </PersonRow>
          ))}
          {data.approved.map((p) => (
            <PersonRow key={p.email} person={p} meta={p.registered ? null : "todavía no entró"}>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`¿Quitarle el acceso a ${p.name ?? p.email}? Se cierran sus sesiones abiertas.`)) {
                    deny(p.email);
                  }
                }}
              >
                Quitar acceso
              </Button>
            </PersonRow>
          ))}
        </ul>
      </Section>

      {data.denied.length ? (
        <Section title="Sin acceso" description="Solicitudes rechazadas o accesos quitados. No vuelven a avisarte.">
          <ul className="divide-y rounded-xl border">
            {data.denied.map((p) => (
              <PersonRow key={p.email} person={p} meta={p.decidedAt ? `sin acceso · ${timeAgo(p.decidedAt)}` : null}>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => grant(p.email)}>
                  <Check /> Dar acceso
                </Button>
              </PersonRow>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
