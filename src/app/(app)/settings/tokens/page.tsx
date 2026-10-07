import type { Metadata } from "next";
import { TokensView } from "@/components/settings/tokens-view";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Tokens de API" };

export default function TokensPage() {
  return <TokensView appUrl={env.appUrl} />;
}
