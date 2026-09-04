import { beforeEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import type * as GenAI from "@google/genai";
import { GoogleGenAIProvider } from "../../src/ai/providers/google-genai";
import { FallbackProvider } from "../../src/ai/providers/fallback";
import type { CodeLensaModelProvider } from "../../src/ai/providers/provider";

const mocks = vi.hoisted(() => ({ generateContent: vi.fn<(request: GenAI.GenerateContentParameters) => Promise<Partial<GenAI.GenerateContentResponse>>>() }));
vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof GenAI>();
  return { ...actual, GoogleGenAI: class { models = { generateContent: mocks.generateContent }; } };
});
const request = { messages: [{ role: "user" as const, content: "How does login work?" }] };
beforeEach(() => vi.clearAllMocks());

function primary(status: number): CodeLensaModelProvider {
  return { id: "mistral", model: "mistral-small-latest", supportsTools: true, supportsStructuredOutput: true,
    chat: vi.fn().mockRejectedValue(OpenAI.APIError.generate(status, { message: "provider error" }, "provider error", new Headers())),
    stream: vi.fn()
  };
}

describe("Mistral to Gemini fallback", () => {
  it("switches on 429 and reports the model that actually answered", async () => {
    mocks.generateContent.mockResolvedValueOnce({ text: "Grounded answer", functionCalls: [] });
    const provider = new FallbackProvider(primary(429), new GoogleGenAIProvider("test-key"));
    const chunks = [];
    for await (const chunk of provider.stream(request)) chunks.push(chunk.content);
    expect(chunks).toEqual(["Grounded answer"]);
    expect(provider.id).toBe("gemini");
    expect(provider.model).toBe("gemini-3.5-flash-lite");
  });
  it("does not hide invalid primary requests with a fallback", async () => {
    const provider = new FallbackProvider(primary(400), new GoogleGenAIProvider("test-key"));
    await expect(provider.chat(request)).rejects.toMatchObject({ status: 400 });
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it("surfaces failure when the fallback also fails", async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error("Gemini unavailable"));
    await expect(new FallbackProvider(primary(429), new GoogleGenAIProvider("test-key")).chat(request)).rejects.toThrow("Gemini unavailable");
  });
});

describe("Google Gen AI repository loop", () => {
  it("executes repository search and preserves the model content and call id", async () => {
    const call = { id: "call-1", name: "search_repository", args: { query: "login" } };
    const modelContent = { role: "model", parts: [{ functionCall: call, thoughtSignature: "preserve-this" }] };
    mocks.generateContent.mockResolvedValueOnce({ functionCalls: [call], candidates: [{ content: modelContent }] });
    mocks.generateContent.mockResolvedValueOnce({ text: "Login is in auth.ts", functionCalls: [] });
    const search = vi.fn().mockResolvedValue({ passages: [{ path: "auth.ts", chunkId: "chunk-1" }] });
    await expect(new GoogleGenAIProvider("test-key", "gemini-3.5-flash-lite", { search }).chat(request)).resolves.toMatchObject({ content: "Login is in auth.ts" });
    expect(search).toHaveBeenCalledExactlyOnceWith("login");
    expect(mocks.generateContent.mock.calls[1]?.[0].contents).toContainEqual(modelContent);
    const contents = mocks.generateContent.mock.calls[1]?.[0].contents as GenAI.Content[];
    expect(contents.at(-1)?.parts?.[0]?.functionResponse).toMatchObject({ id: "call-1", name: "search_repository" });
  });
  it("rejects unsupported tool calls without executing them and stops after three rounds", async () => {
    mocks.generateContent.mockResolvedValue({ functionCalls: [{ name: "delete_repository", args: {} }], candidates: [{ content: { role: "model", parts: [] } }] });
    const search = vi.fn();
    await expect(new GoogleGenAIProvider("test-key", "gemini-3.5-flash-lite", { search }).chat(request)).rejects.toMatchObject({ code: "AGENT_LIMIT_REACHED" });
    expect(search).not.toHaveBeenCalled();
    expect(mocks.generateContent).toHaveBeenCalledTimes(3);
    expect(mocks.generateContent.mock.calls[2]?.[0].config?.tools).toBeUndefined();
  });
});
