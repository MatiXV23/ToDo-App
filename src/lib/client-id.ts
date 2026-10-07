/** Identifica esta pestaña para ignorar los ecos en tiempo real de sus propios cambios. */
export const CLIENT_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
