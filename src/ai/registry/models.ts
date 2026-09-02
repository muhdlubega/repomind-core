import type { ProviderId } from "../../shared/types";
import type { RuntimeConfig } from "../../shared/env";
import { AppError } from "../../shared/errors";
import { CloudflareWorkersAIProvider } from "../providers/cloudflare";
import { createGeminiProvider, createMistralProvider } from "../providers/openai-compatible";
import type { RepoMindModelProvider } from "../providers/provider";

export type ModelPurpose = "generation" | "classification" | "rewrite" | "agent";
export interface ModelDefinition { provider: ProviderId; model: string; purpose: ModelPurpose }

export class ModelRegistry {
  constructor(private readonly env: Env, private readonly config: RuntimeConfig) {}

  definition(purpose: ModelPurpose, requested?: ProviderId): ModelDefinition {
    const provider = requested ?? (purpose === "agent" ? this.config.AGENT_PROVIDER : this.config.AI_PROVIDER);
    if (provider === "cloudflare") return { provider, model: purpose === "agent" && this.config.AGENT_MODEL ? this.config.AGENT_MODEL : this.config.CLOUDFLARE_CHAT_MODEL, purpose };
    if (provider === "gemini") return { provider, model: this.config.GEMINI_MODEL ?? this.config.AGENT_MODEL ?? "", purpose };
    return { provider, model: this.config.MISTRAL_MODEL ?? this.config.AGENT_MODEL ?? "", purpose };
  }

  provider(purpose: ModelPurpose, requested?: ProviderId): RepoMindModelProvider {
    let definition = this.definition(purpose, requested);
    if (definition.provider !== "cloudflare" && purpose === "agent" && !this.config.ENABLE_EXTERNAL_AGENT) definition = this.definition(purpose, "cloudflare");
    if (definition.provider === "cloudflare") return new CloudflareWorkersAIProvider(this.env.AI, definition.model);
    if (definition.provider === "gemini" && this.config.GEMINI_API_KEY && definition.model) return createGeminiProvider(this.config.GEMINI_API_KEY, definition.model);
    if (definition.provider === "mistral" && this.config.MISTRAL_API_KEY && definition.model) return createMistralProvider(this.config.MISTRAL_API_KEY, definition.model);
    if (purpose === "agent" && this.config.ENABLE_AGENT_FALLBACK) return new CloudflareWorkersAIProvider(this.env.AI, this.config.CLOUDFLARE_CHAT_MODEL);
    throw new AppError("MODEL_PROVIDER_UNAVAILABLE", `The configured ${definition.provider} provider is unavailable.`, 503);
  }

  list(): ModelDefinition[] {
    const models = [this.definition("generation", "cloudflare")];
    if (this.config.GEMINI_API_KEY && this.config.GEMINI_MODEL) models.push(this.definition("agent", "gemini"));
    if (this.config.MISTRAL_API_KEY && this.config.MISTRAL_MODEL) models.push(this.definition("agent", "mistral"));
    return models;
  }
}
