import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { LoginCard } from "./login-card";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSessionUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <LoginCard
        googleEnabled={!!env.google}
        devLoginEnabled={env.devLoginEnabled}
        error={typeof error === "string" ? error : null}
      />
    </main>
  );
}
