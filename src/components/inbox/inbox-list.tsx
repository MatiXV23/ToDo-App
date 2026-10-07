"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Bell, CalendarClock, CheckCheck, Inbox, MessageSquare, UserMinus, UserPlus, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/common/empty-state";
import { UserAvatar } from "@/components/common/user-avatar";
import { InvitationActions } from "@/components/projects/invitation-actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { taskKey } from "@/lib/domain";
import { formatDate, timeAgo } from "@/lib/format";
import { type RouterOutputs, useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/server/permissions/labels";

type Notification = RouterOutputs["notification"]["list"][number];

const ICONS: Record<string, typeof Bell> = {
  invitation: UserPlus,
  invitation_accepted: UserRoundCheck,
  assigned: AtSign,
  comment: MessageSquare,
  due_soon: CalendarClock,
  removed_from_project: UserMinus,
};

function describe(n: Notification): { text: React.ReactNode; href: string | null } {
  const actor = <span className="font-medium">{n.actor?.name ?? "Alguien"}</span>;
  const project = n.project ? <span className="font-medium">{n.project.name}</span> : null;
  const task =
    n.task && n.project ? (
      <span className="font-medium">
        <span className="font-mono text-xs text-muted-foreground">{taskKey(n.project.key, n.task.number)}</span>{" "}
        {n.task.title}
      </span>
    ) : null;
  const taskHref =
    n.task && n.project && !n.task.deletedAt ? `/p/${n.project.key}?task=${taskKey(n.project.key, n.task.number)}` : null;
  const data = n.data as { excerpt?: string; dueDate?: string };

  switch (n.type) {
    case "invitation":
      return {
        text: (
          <>
            {actor} te invitó a {project} como {n.invitation ? ROLE_LABELS[n.invitation.role].toLowerCase() : "miembro"}.
          </>
        ),
        href: n.invitation?.status === "accepted" && n.project ? `/p/${n.project.key}` : null,
      };
    case "invitation_accepted":
      return { text: <>{actor} aceptó tu invitación a {project}.</>, href: n.project ? `/p/${n.project.key}/settings` : null };
    case "assigned":
      return { text: <>{actor} te asignó {task}.</>, href: taskHref };
    case "comment":
      return {
        text: (
          <>
            {actor} comentó en {task}
            {data.excerpt ? <span className="text-muted-foreground">: “{data.excerpt}”</span> : null}
          </>
        ),
        href: taskHref,
      };
    case "due_soon":
      return {
        text: (
          <>
            {task} vence {data.dueDate ? `el ${formatDate(data.dueDate, "EEEE d 'de' MMMM")}` : "pronto"}.
          </>
        ),
        href: taskHref,
      };
    case "removed_from_project":
      return { text: <>{actor} te quitó de un proyecto.</>, href: null };
    default:
      return { text: n.type, href: null };
  }
}

export function InboxList() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const list = useQuery(trpc.notification.list.queryOptions());
  const markRead = useMutation(
    trpc.notification.markRead.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.notification.pathFilter()),
    }),
  );
  const unread = (list.data ?? []).filter((n) => !n.readAt);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Buzón</h1>
        <Button variant="outline" size="sm" disabled={unread.length === 0} onClick={() => markRead.mutate({})}>
          <CheckCheck /> Marcar todo como leído
        </Button>
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : !list.data?.length ? (
        <EmptyState icon={Inbox} title="Nada por acá" description="Invitaciones, asignaciones y comentarios aparecen en el buzón." />
      ) : (
        <ul className="divide-y rounded-xl border">
          {list.data.map((n) => {
            const Icon = ICONS[n.type] ?? Bell;
            const { text, href } = describe(n);
            const pendingInvitation = n.type === "invitation" && n.invitation?.status === "pending";
            const body = (
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="relative mt-0.5">
                  <UserAvatar user={n.actor} className="size-7" />
                  <span className="absolute -right-1 -bottom-1 rounded-full border bg-background p-0.5">
                    <Icon className="size-2.5 text-muted-foreground" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{text}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {timeAgo(n.createdAt)}
                    {n.type === "invitation" && n.invitation && n.invitation.status !== "pending"
                      ? ` · ${{ accepted: "Aceptada", declined: "Rechazada", revoked: "Cancelada", pending: "" }[n.invitation.status]}`
                      : null}
                  </p>
                </div>
              </div>
            );
            return (
              <li key={n.id} className={cn("flex items-center gap-3 px-4 py-3", !n.readAt && "bg-brand/5")}>
                {href ? (
                  <Link
                    href={href}
                    className="flex min-w-0 flex-1"
                    onClick={() => !n.readAt && markRead.mutate({ ids: [n.id] })}
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
                {pendingInvitation && n.invitation ? <InvitationActions invitationId={n.invitation.id} /> : null}
                {!n.readAt && !pendingInvitation ? (
                  <button
                    className="size-2 shrink-0 rounded-full bg-brand"
                    aria-label="Marcar como leído"
                    onClick={() => markRead.mutate({ ids: [n.id] })}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
