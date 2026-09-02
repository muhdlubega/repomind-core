import { Annotation } from "@langchain/langgraph";
import type { Citation, QueryType, RetrievedCode } from "../../shared/types";

export const RepoMindStateAnnotation = Annotation.Root({
  repositoryId: Annotation<string>(),
  query: Annotation<string>(),
  queryType: Annotation<QueryType>({ default: () => "general", reducer: (_current, update) => update }),
  rewrittenQueries: Annotation<string[]>({ default: () => [], reducer: (_current, update) => update }),
  symbolResults: Annotation<RetrievedCode[]>({ default: () => [], reducer: (_current, update) => update }),
  semanticResults: Annotation<RetrievedCode[]>({ default: () => [], reducer: (_current, update) => update }),
  graphResults: Annotation<RetrievedCode[]>({ default: () => [], reducer: (_current, update) => update }),
  fusedResults: Annotation<RetrievedCode[]>({ default: () => [], reducer: (_current, update) => update }),
  context: Annotation<RetrievedCode[]>({ default: () => [], reducer: (_current, update) => update }),
  retrievalConfidence: Annotation<number>({ default: () => 0, reducer: (_current, update) => update }),
  answer: Annotation<string>({ default: () => "", reducer: (_current, update) => update }),
  citations: Annotation<Citation[]>({ default: () => [], reducer: (_current, update) => update }),
  citationValidity: Annotation<number>({ default: () => 0, reducer: (_current, update) => update }),
  retryCount: Annotation<number>({ default: () => 0, reducer: (_current, update) => update }),
  agentMode: Annotation<boolean>({ default: () => false, reducer: (_current, update) => update })
});

export type RepoMindState = typeof RepoMindStateAnnotation.State;
