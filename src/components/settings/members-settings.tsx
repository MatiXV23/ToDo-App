"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/common/user-avatar";
import type { ProjectInfo } from "@/components/project/project-context";
import { useCurrentUser } from "@/components/shell/current-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { timeAgo } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { ROLE_LABELS } from "@/server/permissions/labels";
import { SettingsCard } from "./settings-view";

type InviteRole = "editor" | "viewer";

export function MembersSettings({ project }: { project: ProjectInfo }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const me = useCurrentUser();
  const canManage = project.can.includes("member.manage");
  const members = useQuery(trpc.member.list.queryOptions({ projectId: project.id }));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");

  const refresh = () => {
    void queryClient.invalidateQueries(trpc.member.list.queryFilter({ projectId: project.id }));
    void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId: project.id }));
  };
  const invite = useMutation(
    trpc.member.invite.mutationOptions({
      onSuccess: () => {
        toast.success("Invitación enviada. La verá en su buzón al entrar.");
        setEmail("");
        refresh();
      },
    }),
  );
  const revoke = useMutation(trpc.member.revokeInvitation.mutationOptions({ onSuccess: refresh }));
  const changeRole = useMutation(trpc.member.changeRole.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(
    trpc.member.remove.mutationOptions({
      onSuccess: (_r, vars) => {
        if (vars.userId === me.id) {
          void queryClient.invalidateQueries(trpc.project.pathFilter());
          router.push("/");
        } else refresh();
      },
    }),
  );

  return (
    <div className="space-y-6">
      {canManage ? (
        <SettingsCard
          title="Invitar"
          description="La invitación aparece en el buzón de esa persona cuando entra con su cuenta de Google."
        >
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate({ projectId: project.id, email, role });
            }}
          >
            <Input
              type="email"
              required
              placeholder="nombre@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-56 flex-1"
            />
            <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Solo lectura</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={invite.isPending || !email}>
              Invitar
            </Button>
          </form>
          {members.data?.invitations.length ? (
            <ul className="mt-4 divide-y rounded-lg border">
              {members.data.invitations.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Mail className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{inv.email}</span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_LABELS[inv.role]} · pendiente, {timeAgo(inv.createdAt)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Cancelar invitación"
                    onClick={() => revoke.mutate({ invitationId: inv.id })}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </SettingsCard>
      ) : null}

      <SettingsCard title="Miembros">
        <ul className="divide-y rounded-lg border">
          {members.data?.members.map((m) => {
            const isMe = m.userId === me.id;
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <UserAvatar user={m} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.name} {isMe ? <span className="font-normal text-muted-foreground">(vos)</span> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                {canManage && m.role !== "owner" ? (
                  <Select
                    value={m.role}
                    onValueChange={(v) =>
                      changeRole.mutate({ projectId: project.id, userId: m.userId, role: v as InviteRole })
                    }
                  >
                    <SelectTrigger size="sm" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Solo lectura</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</span>
                )}
                {m.role !== "owner" && (canManage || isMe) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      const msg = isMe ? "¿Salir del proyecto?" : `¿Quitar a ${m.name} del proyecto?`;
                      if (window.confirm(msg)) remove.mutate({ projectId: project.id, userId: m.userId });
                    }}
                  >
                    {isMe ? "Salir" : "Quitar"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </SettingsCard>
    </div>
  );
}
