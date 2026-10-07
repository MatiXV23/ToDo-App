import * as z from "zod";
import { createOpenAICompatibleProvider } from "./providers/openai-compatible";
import { AiError, type AiProvider, type ChatMessage } from "./types";

export { AiError } from "./types";

const DEFAULTS: Record<string, { baseUrl: string; model: string; thinkingToggle: boolean }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", thinkingToggle: true },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", thinkingToggle: false },
};

let override: AiProvider | null = null;

/** Para tests: reemplaza el proveedor por uno falso. */
export function setAiProviderForTests(provider: AiProvider | null) {
  override = provider;
}

export function getAiProvider(): AiProvider | null {
  if (override) return override;
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;
  const id = process.env.AI_PROVIDER || "deepseek";
  const defaults = DEFAULTS[id] ?? DEFAULTS.deepseek;
  return createOpenAICompatibleProvider({
    id,
    apiKey,
    baseUrl: process.env.AI_BASE_URL || defaults.baseUrl,
    model: process.env.AI_MODEL || defaults.model,
    supportsThinkingToggle: defaults.thinkingToggle,
  });
}

export function requireAiProvider(): AiProvider {
  const provider = getAiProvider();
  if (!provider) throw new AiError("La IA no está configurada (falta AI_API_KEY)", "not_configured");
  return provider;
}

/** Extrae JSON aunque venga envuelto en ```json ... ```. */
function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

export type GenerateResult<T> = { data: T; model: string; usage: { inputTokens: number; outputTokens: number } };

/**
 * Pide una respuesta estructurada y la valida con Zod. Si no cumple el esquema,
 * reintenta una vez indicándole el error al modelo.
 */
export async function generateObject<T extends z.ZodType>(
  schema: T,
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number; reasoning?: boolean; timeoutMs?: number } = {},
): Promise<GenerateResult<z.infer<T>>> {
  const provider = requireAiProvider();
  const usage = { inputTokens: 0, outputTokens: 0 };
  let conversation = messages;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
    try {
      const result = await provider.complete({
        messages: conversation,
        json: true,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        reasoning: options.reasoning,
        signal: controller.signal,
      });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      let parsed: unknown;
      try {
        parsed = parseJson(result.text);
      } catch {
        lastError = "La respuesta no es JSON válido.";
        conversation = [...messages, { role: "assistant", content: result.text }, { role: "user", content: `${lastError} Respondé solo con el JSON pedido.` }];
        continue;
      }
      const validated = schema.safeParse(parsed);
      if (validated.success) return { data: validated.data, model: result.model, usage };
      lastError = validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      conversation = [
        ...messages,
        { role: "assistant", content: result.text },
        { role: "user", content: `El JSON no cumple el formato (${lastError}). Corregilo y respondé solo con el JSON.` },
      ];
    } finally {
      clearTimeout(timer);
    }
  }
  console.error("[ai] respuesta inválida:", lastError);
  throw new AiError("La IA devolvió una respuesta con formato inválido. Probá de nuevo.", "invalid_output");
}
