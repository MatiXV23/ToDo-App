export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "TOO_MANY_REQUESTS";

/** Error de dominio. Los services lo lanzan; tRPC lo traduce a su propio error. */
export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Recurso") => new AppError("NOT_FOUND", `${what} no encontrado`);
export const forbidden = (message = "No tenés permiso para hacer esto") =>
  new AppError("FORBIDDEN", message);
export const badRequest = (message: string) => new AppError("BAD_REQUEST", message);
export const conflict = (message: string) => new AppError("CONFLICT", message);
