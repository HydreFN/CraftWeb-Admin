import type { AIProvider, ClassifyInput, ClassifyOutput, PersonalizeInput, PersonalizeOutput } from "./types.js";

/**
 * Stubs documentés (V2) — l'interface AIProvider est le seul contrat :
 * pour ajouter OpenAI, Gemini ou Ollama, implémentez personalize() et
 * classify() dans un fichier dédié (mêmes prompts, mêmes schémas JSON —
 * voir anthropic.ts comme référence), puis référencez la classe dans
 * factory.ts. Rien d'autre à modifier dans le reste du code.
 */
abstract class NotImplementedProvider implements AIProvider {
  abstract readonly id: AIProvider["id"];
  readonly model: string;
  constructor(model: string) {
    this.model = model;
  }
  personalize(_input: PersonalizeInput): Promise<PersonalizeOutput> {
    throw new Error(
      `Le fournisseur IA "${this.id}" n'est pas encore implémenté (prévu V2). Utilisez AI_PROVIDER=anthropic.`,
    );
  }
  classify(_input: ClassifyInput): Promise<ClassifyOutput> {
    throw new Error(
      `Le fournisseur IA "${this.id}" n'est pas encore implémenté (prévu V2). Utilisez AI_PROVIDER=anthropic.`,
    );
  }
}

export class OpenAIProvider extends NotImplementedProvider {
  readonly id = "openai" as const;
}
export class GeminiProvider extends NotImplementedProvider {
  readonly id = "gemini" as const;
}
export class OllamaProvider extends NotImplementedProvider {
  readonly id = "ollama" as const;
}
