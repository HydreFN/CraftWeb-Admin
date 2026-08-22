import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider, OllamaProvider, OpenAIProvider } from "./stubs.js";
import type { AIProvider } from "./types.js";

export function createAIProvider(opts: {
  provider: "anthropic" | "openai" | "gemini" | "ollama";
  model: string;
  anthropicApiKey?: string;
}): AIProvider {
  switch (opts.provider) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: opts.anthropicApiKey, model: opts.model });
    case "openai":
      return new OpenAIProvider(opts.model);
    case "gemini":
      return new GeminiProvider(opts.model);
    case "ollama":
      return new OllamaProvider(opts.model);
  }
}

/** true si le fournisseur configuré est réellement utilisable. */
export function isAIConfigured(opts: { provider: string; anthropicApiKey?: string }): boolean {
  return opts.provider === "anthropic" && Boolean(opts.anthropicApiKey);
}
