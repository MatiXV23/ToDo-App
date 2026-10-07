/** Acceso centralizado a la configuración. Se lee en cada llamada para no fallar en build. */
export const env = {
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get timezone() {
    return process.env.APP_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  },
  get google() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  },
  /** Emails con acceso de administrador: aprueban quién puede entrar a la app. */
  get adminEmails() {
    return (process.env.ADMIN_EMAILS ?? "matiperezgordano@gmail.com")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  /** Login sin Google para desarrollo y tests. Nunca activo en producción. */
  get devLoginEnabled() {
    return process.env.NODE_ENV !== "production" && process.env.DEV_LOGIN_ENABLED === "true";
  },
};
