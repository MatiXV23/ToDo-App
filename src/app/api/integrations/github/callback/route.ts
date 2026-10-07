import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { verifyState } from "@/server/oauth-state";
import { getProvider } from "@/server/repo-providers";
import { linkInstallations } from "@/server/services/repos";

/**
 * Vuelta desde GitHub (tras instalar la app o autorizar). Con el código OAuth se verifica
 * qué instalaciones puede ver el usuario: así nadie puede vincular una instalación ajena
 * adivinando su id.
 */
export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user) return NextResponse.redirect(new URL("/login", env.appUrl));
  const url = new URL(req.url);
  const state = verifyState(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  const back = new URL(state?.k ? `/p/${state.k}/settings?tab=github` : "/", env.appUrl);

  if (!state || state.u !== user.id) {
    back.searchParams.set("github", "invalid_state");
    return NextResponse.redirect(back);
  }
  if (!code) {
    // Sin código: falta activar "Request user authorization (OAuth) during installation" en la app.
    back.searchParams.set("github", "missing_code");
    return NextResponse.redirect(back);
  }
  const provider = getProvider("github")!;
  try {
    const installations = await provider.userInstallations(code, `${env.appUrl}/api/integrations/github/callback`);
    await linkInstallations(user.id, provider.id, installations);
    back.searchParams.set("github", installations.length ? "connected" : "no_installations");
  } catch (err) {
    console.error("[github] callback falló", err);
    back.searchParams.set("github", "error");
  }
  return NextResponse.redirect(back);
}
