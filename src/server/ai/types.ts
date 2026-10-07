/**
 * Capa propia de IA: el resto de la app solo conoce esta interfaz. Para cambiar de modelo
 * o de proveedor alcanza con otra implementación y las variables AI_* del .env.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CompletionRequest = {
  messages: ChatMessage[];
  /** Pide JSON válido como respuesta. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Razonamiento extendido: más lento, útil para tareas complejas. */
  reasoning?: boolean;
  signal?: AbortSignal;
};

export type CompletionResult = {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_configured" | "provider" | "invalid_output" | "timeout",
  ) {
    super(message);
    this.name = "AiError";
  }
}
