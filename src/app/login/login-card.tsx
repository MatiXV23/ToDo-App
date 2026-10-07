"use client";

import { KanbanSquare, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";

const DEV_USERS = [
  { name: "Ana (dev)", email: "ana@dev.local" },
  { name: "Bruno (dev)", email: "bruno@dev.local" },
];

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.31 0-6-2.74-6-6.2s2.69-6.2 6-6.2c1.88 0 3.15.8 3.87 1.49l2.64-2.54C16.84 3.2 14.65 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.66 0 9.4-3.98 9.4-9.58 0-.64-.07-1.13-.16-1.62H12z" />
    </svg>
  );
}

export function LoginCard({ googleEnabled, devLoginEnabled }: { googleEnabled: boolean; devLoginEnabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  async function google() {
    setPending("google");
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/" });
    if (error) {
      toast.error(error.message ?? "No se pudo iniciar sesión con Google");
      setPending(null);
    }
  }

  async function devSignIn(user: { email: string; name?: string }) {
    setPending(user.email);
    const res = await fetch("/api/auth/dev/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    });
    if (!res.ok) {
      toast.error("No se pudo iniciar sesión");
      setPending(null);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border bg-background p-8 shadow-sm">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <KanbanSquare className="size-6" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">ToDoApp</h1>
          <p className="text-sm text-muted-foreground">Tus proyectos, sin vueltas.</p>
        </div>
      </div>

      <Button className="w-full" size="lg" variant="outline" disabled={!googleEnabled || !!pending} onClick={google}>
        {pending === "google" ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
        Continuar con Google
      </Button>
      {!googleEnabled ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Google OAuth no está configurado. Completá GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env.
        </p>
      ) : null}

      {devLoginEnabled ? (
        <div className="mt-6">
          <div className="mb-4 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">Desarrollo</span>
            <Separator className="flex-1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEV_USERS.map((u) => (
              <Button key={u.email} variant="secondary" disabled={!!pending} onClick={() => devSignIn(u)}>
                {pending === u.email ? <Loader2 className="animate-spin" /> : null}
                {u.name}
              </Button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (email) void devSignIn({ email });
            }}
          >
            <Input type="email" placeholder="otro@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!email || !!pending}>
              Entrar
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Solo disponible fuera de producción.</p>
        </div>
      ) : null}
    </div>
  );
}
