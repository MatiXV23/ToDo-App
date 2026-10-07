import type { Metadata } from "next";
import { ProjectsHome } from "@/components/projects/projects-home";

export const metadata: Metadata = { title: "Proyectos" };

export default function HomePage() {
  return <ProjectsHome />;
}
