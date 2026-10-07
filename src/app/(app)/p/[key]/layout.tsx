import { ProjectShell } from "@/components/project/project-shell";

export default async function ProjectLayout({ children, params }: LayoutProps<"/p/[key]">) {
  const { key } = await params;
  return <ProjectShell projectKey={key.toUpperCase()}>{children}</ProjectShell>;
}
