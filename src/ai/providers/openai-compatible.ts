import OpenAI from "openai";
import type { ChatChunk, ChatRequest, ChatResponse, ProviderId } from "../../shared/types";
import type { CodeLensaModelProvider } from "./provider";

export class OpenAICompatibleProvider implements CodeLensaModelProvider {
  readonly supportsTools = true;
  readonly supportsStructuredOutput = true;
  private readonly client: OpenAI;

  constructor(readonly id: Exclude<ProviderId, "cloudflare">, readonly model: string, apiKey: string, baseURL: string) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 1200,
      ...(request.responseFormat === "json" ? { response_format: { type: "json_object" as const } } : {})
    });
    return {
      content: response.choices[0]?.message.content ?? "",
      ...(response.usage?.prompt_tokens !== undefined ? { inputTokens: response.usage.prompt_tokens } : {}),
      ...(response.usage?.completion_tokens !== undefined ? { outputTokens: response.usage.completion_tokens } : {})
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 1200,
      stream: true
    });
    for await (const part of response) {
      const content = part.choices[0]?.delta.content;
      if (content) yield { content };
    }
  }
}

export function createGeminiProvider(apiKey: string, model: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider("gemini", model, apiKey, "https://generativelanguage.googleapis.com/v1beta/openai/");
}
export function createMistralProvider(apiKey: string, model: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider("mistral", model, apiKey, "https://api.mistral.ai/v1");
}
