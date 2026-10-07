"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { CLIENT_ID } from "@/lib/client-id";
import { useTRPC } from "@/lib/trpc";
import type { RealtimeEnvelope } from "@/server/events";

/**
 * Escucha cambios por SSE e invalida las queries afectadas. Sin `projectId` escucha
 * el canal del usuario (buzón, proyectos); con `projectId`, el del proyecto.
 */
export function useRealtime(projectId?: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const pending = useRef(new Map<string, () => void>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const schedule = (key: string, fn: () => void) => {
      pending.current.set(key, fn);
      if (timer.current) return;
      timer.current = setTimeout(() => {
        const fns = [...pending.current.values()];
        pending.current.clear();
        timer.current = null;
        fns.forEach((f) => f());
      }, 120);
    };

    const url = projectId ? `/api/realtime?projectId=${projectId}` : "/api/realtime";
    const source = new EventSource(url);
    source.onmessage = (event) => {
      let msg: RealtimeEnvelope;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      // Ecos de cambios hechos en esta misma pestaña: ya están aplicados.
      if (msg.origin && msg.origin === CLIENT_ID) return;

      switch (msg.type) {
        case "board":
          if (!projectId) break;
          schedule("board", () => {
            void queryClient.invalidateQueries(trpc.board.get.queryFilter({ projectId }));
            void queryClient.invalidateQueries(trpc.sprint.backlog.queryFilter({ projectId }));
            void queryClient.invalidateQueries(trpc.epic.pathFilter());
          });
          break;
        case "task":
          schedule(`task:${msg.taskId}`, () => {
            void queryClient.invalidateQueries(trpc.task.get.queryFilter({ taskId: msg.taskId }));
          });
          break;
        case "project":
          schedule("project", () => {
            void queryClient.invalidateQueries(trpc.project.byKey.pathFilter());
            void queryClient.invalidateQueries(trpc.member.list.pathFilter());
            void queryClient.invalidateQueries(trpc.board.get.pathFilter());
            void queryClient.invalidateQueries(trpc.automation.pathFilter());
            void queryClient.invalidateQueries(trpc.github.pathFilter());
          });
          break;
        case "automation":
          schedule("automation", () => {
            void queryClient.invalidateQueries(trpc.automation.pathFilter());
          });
          break;
        case "notification":
          schedule("notification", () => {
            void queryClient.invalidateQueries(trpc.notification.pathFilter());
            void queryClient.invalidateQueries(trpc.member.myInvitations.pathFilter());
          });
          break;
        case "projects":
          schedule("projects", () => {
            void queryClient.invalidateQueries(trpc.project.pathFilter());
          });
          break;
      }
    };
    return () => {
      source.close();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [projectId, queryClient, trpc]);
}
