import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { signState } from "@/server/oauth-state";
import { authorize } from "@/server/permissions/access";
import { getProvider } from "@/server/repo-providers";
import { getProjectByKey } from "@/server/services/projects";

/**
 * Inicia la conexión con GitHub desde los ajustes de un proyecto.
 * mode=install: instalar la GitHub App en una cuenta u organización.
 * mode=link: la app ya está instalada; solo se verifica el acceso del usuario.
 */
export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user) return NextResponse.redirect(new URL("/login", env.appUrl));
  const url = new URL(req.url);
  const projectKey = url.searchParams.get("project") ?? "";
  const mode = url.searchParams.get("mode") === "link" ? "link" : "install";
  const back = new URL(`/p/${projectKey}/settings?tab=github`, env.appUrl);

  const provider = getProvider("github");
  if (!provider?.isConfigured()) {
    back.searchParams.set("github", "not_configured");
    return NextResponse.redirect(back);
  }
  try {
    const actor = { type: "user" as const, userId: user.id };
    const project = await getProjectByKey(actor, projectKey);
    await authorize(db, actor, project.id, "repo.connect");
  } catch {
    back.searchParams.set("github", "forbidden");
    return NextResponse.redirect(back);
  }

  const state = signState({ u: user.id, k: projectKey });
  const redirectUri = `${env.appUrl}/api/integrations/github/callback`;
  return NextResponse.redirect(mode === "install" ? provider.installUrl(state) : provider.authorizeUrl(state, redirectUri));
}
