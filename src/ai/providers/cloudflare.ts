import { z } from "zod";
import type { ChatChunk, ChatRequest, ChatResponse } from "../../shared/types";
import type { RepoMindModelProvider } from "./provider";

const responseSchema = z.union([
  z.object({ response: z.string(), usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional() }),
  z.object({ result: z.object({ response: z.string() }) })
]);

export class CloudflareWorkersAIProvider implements RepoMindModelProvider {
  readonly id = "cloudflare" as const;
  readonly supportsTools = false;
  readonly supportsStructuredOutput = false;

  constructor(private readonly ai: Ai, readonly model: string) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const raw: unknown = await this.ai.run(this.model, {
        messages: request.messages,
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 1200
      });
      const parsed = responseSchema.parse(raw);
      if ("response" in parsed) return { content: parsed.response, ...(parsed.usage?.prompt_tokens !== undefined ? { inputTokens: parsed.usage.prompt_tokens } : {}), ...(parsed.usage?.completion_tokens !== undefined ? { outputTokens: parsed.usage.completion_tokens } : {}) };
      return { content: parsed.result.response };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/quota|capacity|limit|exceeded|credits/i.test(message)) {
        throw new Error("AI_DAILY_CAPACITY_REACHED");
      }
      throw error;
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const raw: unknown = await this.ai.run(this.model, {
      messages: request.messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 1200,
      stream: true
    });
    if (!(raw instanceof ReadableStream)) {
      const completed = await this.chat(request);
      yield { content: completed.content };
      return;
    }
    const reader = raw.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    try {
      let read = await reader.read();
      while (!read.done) {
        pending += read.value;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const data = line.replace(/^data:\s*/, "").trim();
          if (!data || data === "[DONE]") continue;
          const parsed: unknown = JSON.parse(data);
          const token = z.object({ response: z.string().optional() }).safeParse(parsed);
          if (token.success && token.data.response) yield { content: token.data.response };
        }
        read = await reader.read();
      }
    } finally {
      reader.releaseLock();
    }
  }
}
