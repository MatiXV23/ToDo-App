import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessView } from "@/components/admin/access-view";
import { getSessionUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Acceso a la app" };

export default async function AccessPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) notFound();
  return <AccessView />;
}
