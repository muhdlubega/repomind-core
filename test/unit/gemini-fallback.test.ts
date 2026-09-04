import { beforeEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { LangChainGeminiProvider, geminiError } from "../../src/ai/providers/langchain-gemini";
import { FallbackProvider } from "../../src/ai/providers/fallback";
import type { CodeLensaModelProvider } from "../../src/ai/providers/provider";

const mocks = vi.hoisted(() => ({ invoke: vi.fn<(messages: BaseMessage[], options: { signal: AbortSignal }) => Promise<AIMessage>>(), bindTools: vi.fn() }));
vi.mock("@langchain/google", () => ({ ChatGoogle: class {
  invoke = mocks.invoke;
  bindTools(tools: unknown) { mocks.bindTools(tools); return { invoke: mocks.invoke }; }
} }));
const request = { messages: [{ role: "user" as const, content: "How does login work?" }] };
beforeEach(() => vi.resetAllMocks());
function primary(status: number): CodeLensaModelProvider {
  return { id: "mistral", model: "mistral-small-latest", supportsTools: true, supportsStructuredOutput: true,
    chat: vi.fn().mockRejectedValue(OpenAI.APIError.generate(status, { message: "provider error" }, "provider error", new Headers())), stream: vi.fn() };
}
describe("Mistral to LangChain Gemini fallback", () => {
  it("switches on 429 and reports the model that answered", async () => {
    mocks.invoke.mockResolvedValueOnce(new AIMessage("Grounded answer"));
    const provider = new FallbackProvider(primary(429), new LangChainGeminiProvider("test-key"));
    const chunks = [];
    for await (const chunk of provider.stream(request)) chunks.push(chunk.content);
    expect(chunks).toEqual(["Grounded answer"]);
    expect(provider.id).toBe("gemini");
    expect(provider.model).toBe("gemini-3.5-flash-lite");
  });
  it("does not retry invalid primary requests", async () => {
    await expect(new FallbackProvider(primary(400), new LangChainGeminiProvider("test-key")).chat(request)).rejects.toMatchObject({ status: 400 });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("preserves a useful error if Gemini is also unavailable", async () => {
    mocks.invoke.mockRejectedValueOnce({ statusCode: 503 });
    await expect(new FallbackProvider(primary(429), new LangChainGeminiProvider("test-key")).chat(request)).rejects.toMatchObject({ code: "GEMINI_BUSY" });
    expect(geminiError({ statusCode: 429 }).code).toBe("GEMINI_RATE_LIMITED");
    expect(geminiError({ statusCode: 403 }).code).toBe("GEMINI_CONFIGURATION_ERROR");
  });
});
describe("LangChain repository tool loop", () => {
  it("executes search and preserves complete AI messages and call ids", async () => {
    const response = new AIMessage({ content: "", tool_calls: [{ id: "call-1", name: "search_repository", args: { query: "login" } }], additional_kwargs: { signature: "preserve-this" } });
    mocks.invoke.mockResolvedValueOnce(response).mockResolvedValueOnce(new AIMessage("Login is in auth.ts"));
    const search = vi.fn().mockResolvedValue({ passages: [{ path: "auth.ts", chunkId: "chunk-1" }] });
    await expect(new LangChainGeminiProvider("test-key", "gemini-3.5-flash-lite", { search }).chat(request)).resolves.toMatchObject({ content: "Login is in auth.ts" });
    expect(search).toHaveBeenCalledExactlyOnceWith("login");
    const messages = mocks.invoke.mock.calls[1]?.[0];
    expect(messages).toContain(response);
    expect(messages?.find(message => message instanceof ToolMessage)).toMatchObject({ tool_call_id: "call-1", name: "search_repository" });
    expect(mocks.invoke.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });
  it("rejects unsupported tools and stops after three rounds", async () => {
    mocks.invoke.mockResolvedValue(new AIMessage({ content: "", tool_calls: [{ id: "bad", name: "delete_repository", args: {} }] }));
    const search = vi.fn();
    await expect(new LangChainGeminiProvider("test-key", "gemini-3.5-flash-lite", { search }).chat(request)).rejects.toMatchObject({ code: "AGENT_LIMIT_REACHED" });
    expect(search).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });
  it("rejects malformed search arguments without accessing the repository", async () => {
    mocks.invoke.mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [{ id: "bad", name: "search_repository", args: { query: "" } }] })).mockResolvedValueOnce(new AIMessage("Please clarify."));
    const search = vi.fn();
    await new LangChainGeminiProvider("test-key", "gemini-3.5-flash-lite", { search }).chat(request);
    expect(search).not.toHaveBeenCalled();
  });
});
