import { AiError, type AiProvider, type CompletionRequest, type CompletionResult } from "../types";

type Options = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Algunos proveedores (DeepSeek V4) activan el razonamiento por defecto y aceptan desactivarlo. */
  supportsThinkingToggle?: boolean;
};

/** Cliente para APIs compatibles con /chat/completions de OpenAI (DeepSeek, OpenRouter, etc.). */
export function createOpenAICompatibleProvider(options: Options): AiProvider {
  return {
    id: options.id,
    model: options.model,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.4,
        max_tokens: request.maxTokens ?? 1500,
      };
      if (request.json) body.response_format = { type: "json_object" };
      if (options.supportsThinkingToggle) body.thinking = { type: request.reasoning ? "enabled" : "disabled" };

      let res: Response;
      try {
        res = await fetch(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw new AiError("La IA tardó demasiado en responder", "timeout");
        throw new AiError("No se pudo contactar al proveedor de IA", "provider");
      }
      if (!res.ok) {
        let detail = res.statusText;
        try {
          detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? detail;
        } catch {}
        console.error(`[ai] ${options.id} respondió ${res.status}: ${detail}`);
        throw new AiError(res.status === 401 ? "La API key de IA es inválida" : "El proveedor de IA devolvió un error", "provider");
      }
      const data = (await res.json()) as {
        model?: string;
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        model: data.model ?? options.model,
        usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
