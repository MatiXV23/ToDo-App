"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useProject } from "@/components/project/project-context";
import { cn } from "@/lib/utils";
import { AgentSettings } from "./agent-settings";
import { ColumnsSettings } from "./columns-settings";
import { GeneralSettings } from "./general-settings";
import { GithubSettings } from "./github-settings";
import { MembersSettings } from "./members-settings";
import { TagsSettings } from "./tags-settings";

const SECTIONS = [
  { id: "general", label: "General" },
  { id: "members", label: "Miembros" },
  { id: "columns", label: "Columnas" },
  { id: "tags", label: "Tags" },
  { id: "github", label: "GitHub" },
  { id: "agent", label: "Agente Claude" },
] as const;

type Section = (typeof SECTIONS)[number]["id"];

export function SettingsView() {
  const project = useProject();
  const params = useSearchParams();
  const initial = SECTIONS.find((s) => s.id === params.get("tab"))?.id ?? "general";
  const [section, setSection] = useState<Section>(initial);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:flex-row md:px-6">
      <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-44 md:flex-col">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-left text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground",
              section === s.id && "bg-muted font-medium text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {section === "general" ? <GeneralSettings project={project} /> : null}
        {section === "members" ? <MembersSettings project={project} /> : null}
        {section === "columns" ? <ColumnsSettings project={project} /> : null}
        {section === "tags" ? <TagsSettings project={project} /> : null}
        {section === "github" ? <GithubSettings project={project} /> : null}
        {section === "agent" ? <AgentSettings project={project} /> : null}
      </div>
    </div>
  );
}

export function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border p-5", className)}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
