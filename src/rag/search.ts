import type { RuntimeConfig } from "../shared/env";
import type { RetrievedCode } from "../shared/types";
import { lexicalSearch } from "./retrievers/lexical";
import { semanticSearch } from "./retrievers/semantic";
import { graphSearch } from "./retrievers/graph";
import { reciprocalRankFusion } from "./fusion/rrf";
import { DeterministicCodeReranker } from "./reranking/deterministic";

export type SearchStrategy = "vector" | "lexical" | "hybrid" | "hybrid_graph" | "hybrid_graph_rerank";

export async function searchRepository(env: Env, config: RuntimeConfig, repositoryId: string, query: string, strategy: SearchStrategy, limit = 20): Promise<RetrievedCode[]> {
  if (strategy === "vector") return (await semanticSearch(env, config.CLOUDFLARE_EMBEDDING_MODEL, repositoryId, query, limit)).slice(0, limit);
  if (strategy === "lexical") return (await lexicalSearch(env.DB, repositoryId, query, limit)).slice(0, limit);
  const [lexical, semantic] = await Promise.all([lexicalSearch(env.DB, repositoryId, query, limit), semanticSearch(env, config.CLOUDFLARE_EMBEDDING_MODEL, repositoryId, query, limit)]);
  let fused = reciprocalRankFusion([lexical, semantic]);
  if (strategy === "hybrid") return fused.slice(0, limit);
  const graph = await graphSearch(env.DB, repositoryId, fused.slice(0, 8).map((item) => item.id), { depth: config.MAX_GRAPH_DEPTH, limit });
  fused = reciprocalRankFusion([lexical, semantic, graph]);
  if (strategy === "hybrid_graph") return fused.slice(0, limit);
  return (await new DeterministicCodeReranker().rerank(query, fused)).slice(0, limit);
}

export async function retrievalCacheKey(repositoryId: string, commitSha: string, query: string, strategy: SearchStrategy, model: string): Promise<string> {
  const value = `${repositoryId}\n${commitSha}\n${query.trim().toLowerCase()}\nretrieval-v1\n${strategy}\n${model}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `retrieval:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
