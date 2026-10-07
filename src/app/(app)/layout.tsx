import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getSessionUser } from "@/server/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <AppShell user={user}>{children}</AppShell>;
}
