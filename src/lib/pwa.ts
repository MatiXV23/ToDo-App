"use client";

import { useSyncExternalStore } from "react";

/** Evento de Chrome/Edge/Android para ofrecer la instalación desde la propia app. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let installEvent: BeforeInstallPromptEvent | null = null;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Registra el service worker y escucha si el navegador permite instalar la app. */
export function startPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    installEvent = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    emit();
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** true cuando el navegador ofrece instalar la app (en iOS: Compartir → Agregar a inicio). */
export function useCanInstall() {
  return useSyncExternalStore(
    subscribe,
    () => installEvent !== null,
    () => false,
  );
}

export async function promptInstall() {
  if (!installEvent) return;
  const event = installEvent;
  await event.prompt();
  await event.userChoice;
  installEvent = null;
  emit();
}
