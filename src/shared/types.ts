export type QueryType = "symbol" | "implementation" | "architecture" | "debugging" | "impact" | "testing" | "general";
export type RepositoryStatus = "queued" | "fetching" | "parsing" | "embedding" | "building_graph" | "finalizing" | "ready" | "failed";
export type Relationship = "IMPORTS" | "CALLS" | "REFERENCES" | "EXTENDS" | "IMPLEMENTS" | "RENDERS" | "EXPORTS" | "DEFINED_IN" | "TESTS";
export type ProviderId = "cloudflare" | "gemini" | "mistral";

export interface CodeChunkMetadata {
  repositoryId: string;
  commitSha: string;
  path: string;
  language: string;
  symbol?: string;
  symbolType?: string;
  startLine: number;
  endLine: number;
  imports?: string[];
  exports?: string[];
  parentSymbol?: string;
  contentHash: string;
}

export interface RetrievedCode extends CodeChunkMetadata {
  id: string;
  fileId: string;
  content: string;
  score: number;
  source: "lexical" | "semantic" | "graph";
  reasons: string[];
}

export interface Citation {
  id: string;
  fileId: string;
  path: string;
  symbol?: string;
  startLine: number;
  endLine: number;
  chunkId: string;
  claim?: string;
}

export interface ChatRequest {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}
export interface ChatResponse { content: string; inputTokens?: number; outputTokens?: number }
export interface ChatChunk { content: string }

export interface CodeLensaAnswer {
  id: string;
  answer: string;
  citations: Citation[];
  retrieval: { queryType: QueryType; chunksRetrieved: number; filesUsed: number; confidence: number };
  model: { provider: string; model: string };
  timing: { retrievalMs: number; generationMs: number; totalMs: number };
}

export interface IndexJobMessage { cursor?: number; kind: "index"; repositoryId: string; jobId: string; githubOwner: string; githubRepo: string }
export interface EvaluationJobMessage { kind: "evaluation"; repositoryId: string; runId: string; strategy: "vector" | "lexical" | "hybrid" | "hybrid_graph" | "hybrid_graph_rerank" }
export type QueueJobMessage = IndexJobMessage | EvaluationJobMessage;

export interface AuthPrincipal { userId: string; firebaseUid: string; anonymous: false }
export interface AnonymousPrincipal { userId: null; firebaseUid: null; anonymous: true }
export type Principal = AuthPrincipal | AnonymousPrincipal;
