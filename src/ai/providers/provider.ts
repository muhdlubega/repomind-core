import type { ChatChunk, ChatRequest, ChatResponse, ProviderId } from "../../shared/types";

export interface RepoMindModelProvider {
  readonly id: ProviderId;
  readonly model: string;
  readonly supportsTools: boolean;
  readonly supportsStructuredOutput: boolean;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
}
