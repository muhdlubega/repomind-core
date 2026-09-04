import type { RuntimeConfig } from "../shared/env";
import type { RetrievedCode } from "../shared/types";
import { lexicalSearch } from "./retrievers/lexical";

export type SearchStrategy = "vector" | "lexical" | "hybrid" | "hybrid_graph" | "hybrid_graph_rerank";

export async function searchRepository(env: Env, config: RuntimeConfig, repositoryId: string, query: string, strategy: SearchStrategy, limit = 20): Promise<RetrievedCode[]> {
  void config;
  void strategy;
  const results = await lexicalSearch(env.DB, repositoryId, query, limit);
  return results;
}

export async function retrievalCacheKey(repositoryId: string, commitSha: string, query: string, strategy: SearchStrategy, model: string): Promise<string> {
  const value = `${repositoryId}\n${commitSha}\n${query.trim().toLowerCase()}\nretrieval-v1\n${strategy}\n${model}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `retrieval:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
