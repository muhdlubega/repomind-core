import OpenAI from "openai";
import type { ChatChunk, ChatRequest, ChatResponse } from "../../shared/types";
import { AppError } from "../../shared/errors";
import type { CodeLensaModelProvider } from "./provider";

export function canFallback(error: unknown): boolean {
  if (error instanceof OpenAI.APIConnectionError) return true;
  if (error instanceof AppError) return ["MODEL_PROVIDER_UNAVAILABLE", "EMPTY_MODEL_ANSWER"].includes(error.code);
  if (error instanceof OpenAI.APIError) return error.status === 429 || error.status === 401 || error.status === 403 || (error.status !== undefined && error.status >= 500);
  return false;
}

export class FallbackProvider implements CodeLensaModelProvider {
  readonly supportsTools = true;
  readonly supportsStructuredOutput = true;
  private active: CodeLensaModelProvider;
  constructor(private readonly primary: CodeLensaModelProvider, private readonly fallback: CodeLensaModelProvider) { this.active = primary; }
  get id() { return this.active.id; }
  get model() { return this.active.model; }
  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const response = await this.primary.chat(request);
      if (!response.content.trim()) throw new AppError("EMPTY_MODEL_ANSWER", "The primary provider returned an empty answer.", 502);
      this.active = this.primary;
      return response;
    } catch (error) {
      if (!canFallback(error)) throw error;
      console.info(JSON.stringify({ event: "model_fallback", from: this.primary.id, to: this.fallback.id }));
      this.active = this.fallback;
      return this.fallback.chat(request);
    }
  }
  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    // Do not expose a partial primary answer that could be mixed with fallback.
    const response = await this.chat(request);
    yield { content: response.content };
  }
}
