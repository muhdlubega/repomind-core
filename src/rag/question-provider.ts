import type { RuntimeConfig } from "../shared/env";
import type { RetrievedCode } from "../shared/types";
import { ModelRegistry } from "../ai/registry/models";
import { LangChainGeminiProvider } from "../ai/providers/langchain-gemini";
import { FallbackProvider } from "../ai/providers/fallback";
import { searchRepository } from "./search";
import { buildContext } from "./context/builder";

export function questionProvider(env: Env, config: RuntimeConfig, repositoryId: string, evidence: RetrievedCode[]) {
  const gemini = config.GEMINI_API_KEY ? new LangChainGeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL, {
    async search(query) {
      const results = buildContext(await searchRepository(env, config, repositoryId, query, "lexical", 6), { maxChunks: 6, maxPerFile: 2, maxTokens: 3000 });
      const accepted = results.filter(item => evidence.some(existing => existing.id === item.id) || evidence.length < 32);
      for (const item of accepted) if (!evidence.some(existing => existing.id === item.id) && evidence.length < 32) evidence.push(item);
      return { passages: accepted.filter(item => evidence.some(existing => existing.id === item.id)).map(item => ({ chunkId: item.id, path: item.path, startLine: item.startLine, endLine: item.endLine, content: item.content })) };
    }
  }) : undefined;
  if (gemini && (config.AI_PROVIDER === "gemini" || !evidence.length)) return gemini;
  const primary = new ModelRegistry(env, config).provider("generation");
  return gemini ? new FallbackProvider(primary, gemini) : primary;
}
