"use client";

import { createContext, useContext } from "react";
import type { Action } from "@/server/permissions";
import type { RouterOutputs } from "@/lib/trpc";

export type ProjectInfo = RouterOutputs["project"]["byKey"];

const ProjectContext = createContext<ProjectInfo | null>(null);

export function ProjectProvider({ project, children }: { project: ProjectInfo; children: React.ReactNode }) {
  return <ProjectContext value={project}>{children}</ProjectContext>;
}

export function useProject() {
  const project = useContext(ProjectContext);
  if (!project) throw new Error("useProject fuera de ProjectProvider");
  return project;
}

/** Permisos del usuario actual en el proyecto (la verificación real ocurre en el servidor). */
export function useCan() {
  const project = useProject();
  return (action: Action) => project.can.includes(action);
}
