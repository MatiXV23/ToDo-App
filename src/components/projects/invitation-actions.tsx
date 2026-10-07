"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/lib/trpc";

export function InvitationActions({ invitationId }: { invitationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const respond = useMutation(
    trpc.member.respond.mutationOptions({
      onSuccess: (result, vars) => {
        void queryClient.invalidateQueries(trpc.notification.pathFilter());
        void queryClient.invalidateQueries(trpc.member.myInvitations.pathFilter());
        void queryClient.invalidateQueries(trpc.project.list.pathFilter());
        if (vars.accept && result.projectKey) {
          toast.success("Te uniste al proyecto");
          router.push(`/p/${result.projectKey}`);
        }
      },
    }),
  );
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={respond.isPending} onClick={() => respond.mutate({ invitationId, accept: true })}>
        Aceptar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={respond.isPending}
        onClick={() => respond.mutate({ invitationId, accept: false })}
      >
        Rechazar
      </Button>
    </div>
  );
}
