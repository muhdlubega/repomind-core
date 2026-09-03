import type { Citation, CodeLensaAnswer, RetrievedCode } from "../shared/types";

const timestamp = "2026-09-03T00:00:00.000Z";

export const demoRepository = {
  id: "demo",
  github_url: "https://github.com/muhdlubega/codelensa-core",
  github_owner: "muhdlubega",
  github_repo: "codelensa-core",
  default_branch: "main",
  commit_sha: "demo",
  status: "ready",
  is_demo: true,
  indexed_at: timestamp,
  created_at: timestamp,
  updated_at: timestamp
};

export const demoFiles = [
  {
    id: "f1",
    path: "src/api/chat.ts",
    language: "typescript",
    content_hash: "a1",
    size_bytes: 4210,
    line_count: 138,
    content: "The chat API retrieves repository context, asks the generation provider for an answer, and returns citations that point back to code."
  },
  {
    id: "f2",
    path: "src/retrieval/hybrid.ts",
    language: "typescript",
    content_hash: "b2",
    size_bytes: 6830,
    line_count: 212,
    content: "Hybrid search combines lexical matches with vector candidates, applies reciprocal-rank fusion, then expands high-confidence symbols through the dependency graph."
  },
  {
    id: "f3",
    path: "src/graph/expand.ts",
    language: "typescript",
    content_hash: "c3",
    size_bytes: 3250,
    line_count: 104,
    content: "Graph expansion adds neighboring callers and callees at a bounded depth so investigative questions can include architectural context."
  }
];

export const demoCitations: Citation[] = [
  {
    id: "c1",
    fileId: "f2",
    path: "src/retrieval/hybrid.ts",
    symbol: "hybridSearch",
    startLine: 1,
    endLine: 15,
    chunkId: "ch-12",
    claim: "Combines lexical and semantic candidates with reciprocal-rank fusion."
  },
  {
    id: "c2",
    fileId: "f3",
    path: "src/graph/expand.ts",
    symbol: "expandThroughGraph",
    startLine: 1,
    endLine: 4,
    chunkId: "ch-31",
    claim: "Expands relevant symbols through bounded graph neighbors."
  }
];

export const demoSearchResults: RetrievedCode[] = [
  {
    id: "ch-12",
    fileId: "f2",
    repositoryId: "demo",
    commitSha: "demo",
    path: "src/retrieval/hybrid.ts",
    language: "typescript",
    symbol: "hybridSearch",
    symbolType: "function",
    startLine: 1,
    endLine: 15,
    contentHash: "b2",
    content: "hybridSearch retrieves lexical and vector candidates, fuses their ranks, expands through graph neighbors when requested, deduplicates chunks, and sorts by final relevance.",
    score: 0.94,
    source: "lexical",
    reasons: ["demo fixture", "hybrid search", "graph rerank"]
  },
  {
    id: "ch-31",
    fileId: "f3",
    repositoryId: "demo",
    commitSha: "demo",
    path: "src/graph/expand.ts",
    language: "typescript",
    symbol: "expandThroughGraph",
    symbolType: "function",
    startLine: 1,
    endLine: 4,
    contentHash: "c3",
    content: "expandThroughGraph adds related callers and callees within a bounded graph depth, then merges those neighbors back into the ranked evidence set.",
    score: 0.87,
    source: "graph",
    reasons: ["demo fixture", "dependency graph", "callers and callees"]
  }
];

export function filterDemoSearch(query: string, limit = 20): RetrievedCode[] {
  const needle = query.trim().toLowerCase();
  const terms = needle.split(/\s+/).filter(Boolean);
  const matches = needle
    ? demoSearchResults.filter((result) => {
        const haystack = `${result.path} ${result.symbol ?? ""} ${result.content}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
    : demoSearchResults;
  return matches.slice(0, limit);
}

export function buildDemoAnswer(query: string): CodeLensaAnswer {
  return {
    id: crypto.randomUUID(),
    answer: `For the demo repository, CodeLensa ranks code by blending lexical matches with vector-style semantic candidates, then expands promising symbols through the graph when the question needs architectural context. Query: "${query}".`,
    citations: demoCitations,
    retrieval: {
      queryType: "architecture",
      chunksRetrieved: demoSearchResults.length,
      filesUsed: new Set(demoSearchResults.map((result) => result.path)).size,
      confidence: 0.94
    },
    model: { provider: "demo", model: "fixture" },
    timing: { retrievalMs: 12, generationMs: 8, totalMs: 20 }
  };
}
