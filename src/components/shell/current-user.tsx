"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@/server/auth";

const CurrentUserContext = createContext<SessionUser | null>(null);

export function CurrentUserProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return <CurrentUserContext value={user}>{children}</CurrentUserContext>;
}

export function useCurrentUser() {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error("useCurrentUser fuera de CurrentUserProvider");
  return user;
}
