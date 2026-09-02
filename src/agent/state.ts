import type { Citation, RetrievedCode } from "../shared/types";

export interface InvestigationState {
  repositoryId: string;
  query: string;
  iterationCount: number;
  toolCalls: Array<{ tool: string; query: string }>;
  evidence: RetrievedCode[];
  answer: string;
  citations: Citation[];
  done: boolean;
}
