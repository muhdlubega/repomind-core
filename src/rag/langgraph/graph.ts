import { END, START, StateGraph } from "@langchain/langgraph";
import type { RuntimeConfig } from "../../shared/env";
import type { RepoMindModelProvider } from "../../ai/providers/provider";
import { generationPrompt } from "../../ai/prompts/generation";
import { lexicalSearch } from "../retrievers/lexical";
import { semanticSearch } from "../retrievers/semantic";
import { graphSearch } from "../retrievers/graph";
import { reciprocalRankFusion } from "../fusion/rrf";
import { DeterministicCodeReranker } from "../reranking/deterministic";
import { buildContext } from "../context/builder";
import { citationsFromAnswer, validateCitations } from "../citations/validator";
import { retrievalConfidence } from "../confidence/calculate";
import { classifyQuestion, deterministicRewrite, normalizeQuestion } from "../routing/classifier";
import { RepoMindStateAnnotation, type RepoMindState } from "./state";

export interface RagGraphDependencies { env: Env; config: RuntimeConfig; provider: RepoMindModelProvider }

export function buildRagGraph(dependencies: RagGraphDependencies) {
  const reranker = new DeterministicCodeReranker();
  const normalize = (state: RepoMindState) => ({ query: normalizeQuestion(state.query), rewrittenQueries: [normalizeQuestion(state.query)] });
  const classify = (state: RepoMindState) => ({ queryType: classifyQuestion(state.query) });
  const rewrite = (state: RepoMindState) => ({ rewrittenQueries: deterministicRewrite(state.query), retryCount: state.retryCount + 1 });
  const retrieve = async (state: RepoMindState) => {
    const query = state.rewrittenQueries.at(-1) ?? state.query;
    const [symbolResults, semanticResults] = await Promise.all([
      lexicalSearch(dependencies.env.DB, state.repositoryId, query),
      semanticSearch(dependencies.env, dependencies.config.CLOUDFLARE_EMBEDDING_MODEL, state.repositoryId, query)
    ]);
    return { symbolResults, semanticResults, graphResults: [] };
  };
  const fuse = async (state: RepoMindState) => ({ fusedResults: await reranker.rerank(state.query, reciprocalRankFusion([state.symbolResults, state.semanticResults])) });
  const expand = async (state: RepoMindState) => {
    if (!["architecture", "debugging", "impact", "testing"].includes(state.queryType)) return { graphResults: [], fusedResults: state.fusedResults };
    const relationships = state.queryType === "testing" ? ["TESTS" as const, "IMPORTS" as const, "REFERENCES" as const] : undefined;
    const graphResults = await graphSearch(dependencies.env.DB, state.repositoryId, state.fusedResults.slice(0, 5).map((item) => item.id), { depth: dependencies.config.MAX_GRAPH_DEPTH, ...(relationships ? { relationships } : {}) });
    return { graphResults, fusedResults: await reranker.rerank(state.query, reciprocalRankFusion([state.symbolResults, state.semanticResults, graphResults])) };
  };
  const context = (state: RepoMindState) => ({ context: buildContext(state.fusedResults) });
  const check = (state: RepoMindState) => ({ retrievalConfidence: retrievalConfidence(state.fusedResults, state.context, []) });
  const routeContext = (state: RepoMindState): "retry" | "good" => state.context.length < 2 && state.retryCount < 1 ? "retry" : "good";
  const generate = async (state: RepoMindState) => {
    if (!state.context.length) return { answer: "I could not find enough repository evidence to answer this question reliably.", citations: [] };
    const response = await dependencies.provider.chat({ messages: [{ role: "user", content: generationPrompt(state.query, state.context) }], temperature: 0.1, maxTokens: 1500 });
    return { answer: response.content, citations: citationsFromAnswer(response.content, state.context) };
  };
  const validate = async (state: RepoMindState) => {
    const validation = await validateCitations(dependencies.env.DB, state.repositoryId, state.citations, state.context);
    const answer = validation.invalid.length && !validation.valid.length ? "The retrieved evidence was insufficient to produce a citation-valid answer." : state.answer;
    return { citations: validation.valid, citationValidity: validation.validity, answer };
  };
  const confidence = (state: RepoMindState) => ({ retrievalConfidence: retrievalConfidence(state.fusedResults, state.context, state.citations) });

  return new StateGraph(RepoMindStateAnnotation)
    .addNode("normalize_question", normalize)
    .addNode("classify_question", classify)
    .addNode("rewrite_question", rewrite)
    .addNode("hybrid_search", retrieve)
    .addNode("fuse_results", fuse)
    .addNode("expand_dependencies", expand)
    .addNode("build_context", context)
    .addNode("check_context", check)
    .addNode("generate_answer", generate)
    .addNode("validate_citations", validate)
    .addNode("calculate_confidence", confidence)
    .addEdge(START, "normalize_question")
    .addEdge("normalize_question", "classify_question")
    .addEdge("classify_question", "hybrid_search")
    .addEdge("rewrite_question", "hybrid_search")
    .addEdge("hybrid_search", "fuse_results")
    .addEdge("fuse_results", "expand_dependencies")
    .addEdge("expand_dependencies", "build_context")
    .addEdge("build_context", "check_context")
    .addConditionalEdges("check_context", routeContext, { retry: "rewrite_question", good: "generate_answer" })
    .addEdge("generate_answer", "validate_citations")
    .addEdge("validate_citations", "calculate_confidence")
    .addEdge("calculate_confidence", END)
    .compile();
}
