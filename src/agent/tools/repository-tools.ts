import type { RuntimeConfig } from "../../shared/env";
import type { RetrievedCode } from "../../shared/types";
import { lexicalSearch } from "../../rag/retrievers/lexical";
import { semanticSearch } from "../../rag/retrievers/semantic";
import { graphSearch } from "../../rag/retrievers/graph";

export type InvestigationTool = "search_code" | "search_symbols" | "semantic_search" | "find_references" | "find_callers" | "find_callees" | "find_importers" | "find_imports" | "get_related_tests" | "expand_dependency_graph" | "search_repository_structure";

export async function executeInvestigationTool(env: Env, config: RuntimeConfig, repositoryId: string, tool: InvestigationTool, query: string, evidence: RetrievedCode[]): Promise<RetrievedCode[]> {
  if (tool === "semantic_search") return semanticSearch(env, config.CLOUDFLARE_EMBEDDING_MODEL, repositoryId, query, 15);
  if (["find_references", "find_callers", "find_callees", "find_importers", "find_imports", "get_related_tests", "expand_dependency_graph"].includes(tool)) {
    const seeds = evidence.length ? evidence.slice(0, 8) : await lexicalSearch(env.DB, repositoryId, query, 8);
    return graphSearch(env.DB, repositoryId, seeds.map((item) => item.id), { depth: config.MAX_GRAPH_DEPTH, limit: 30 });
  }
  return lexicalSearch(env.DB, repositoryId, query, 20);
}
