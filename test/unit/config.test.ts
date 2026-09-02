import { describe, expect, it } from "vitest";
import { runtimeConfigSchema } from "../../src/shared/env";

const base = {
  FRONTEND_URL: "https://app.example.com",
  CLOUDFLARE_CHAT_MODEL: "chat-model",
  CLOUDFLARE_EMBEDDING_MODEL: "embedding-model"
};

describe("runtime configuration", () => {
  it("coerces bounded limits and keeps external agents disabled by default", () => {
    const config = runtimeConfigSchema.parse({ ...base, AGENT_MAX_ITERATIONS: "6", MAX_GRAPH_DEPTH: "2" });
    expect(config.AGENT_MAX_ITERATIONS).toBe(6);
    expect(config.MAX_GRAPH_DEPTH).toBe(2);
    expect(config.ENABLE_EXTERNAL_AGENT).toBe(false);
  });

  it("rejects unbounded agent loops and graph traversal", () => {
    expect(runtimeConfigSchema.safeParse({ ...base, AGENT_MAX_ITERATIONS: "13" }).success).toBe(false);
    expect(runtimeConfigSchema.safeParse({ ...base, MAX_GRAPH_DEPTH: "5" }).success).toBe(false);
  });
});
