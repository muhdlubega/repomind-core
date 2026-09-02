import { describe, expect, it } from "vitest";
import { classifyQuestion, deterministicRewrite, normalizeQuestion } from "../../src/rag/routing/classifier";
import { citationsFromAnswer } from "../../src/rag/citations/validator";
import { calculateRetrievalMetrics } from "../../src/evaluation/metrics/retrieval";
import { chatSchema, searchSchema } from "../../src/api/schemas/requests";
import type { RetrievedCode } from "../../src/shared/types";

describe("routing and validation", () => {
  it.each([
    ["Where is useAuthorize implemented?", "implementation"],
    ["Explain the request flow to the database", "architecture"],
    ["Why might this state become stale?", "debugging"],
    ["What is affected if I change this?", "impact"],
    ["Which tests cover this component?", "testing"],
    ["WalletDropdown", "symbol"]
  ])("routes %s to %s", (query, expected) => { expect(classifyQuestion(query)).toBe(expected); });
  it("normalizes and bounds rewrites", () => {
    expect(normalizeQuestion("  where   is auth  ")).toBe("where is auth");
    expect(deterministicRewrite("Where is authentication implemented?")).toHaveLength(2);
  });
  it("rejects invalid API bodies", () => {
    expect(searchSchema.safeParse({ query: "" }).success).toBe(false);
    expect(chatSchema.safeParse({ query: "ok", extra: true }).success).toBe(false);
  });
});

describe("citations and evaluation", () => {
  it("only resolves citations present in generation context", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const context: RetrievedCode[] = [{ id, fileId: "f", repositoryId: "r", commitSha: "s", path: "src/auth.ts", language: "typescript", symbol: "auth", startLine: 2, endLine: 8, contentHash: "h", content: "code", score: 1, source: "lexical", reasons: [] }];
    const citations = citationsFromAnswer(`Auth is initialized here [chunk:${id}] and nowhere [chunk:00000000-0000-0000-0000-000000000000].`, context);
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ path: "src/auth.ts", startLine: 2, endLine: 8 });
  });
  it("calculates deterministic retrieval metrics", () => {
    const metrics = calculateRetrievalMetrics([{ rankedFiles: ["wrong.ts", "auth.ts"], rankedSymbols: ["Auth"], expectedFiles: ["auth.ts"], expectedSymbols: ["Auth"] }]);
    expect(metrics.recallAt1).toBe(0);
    expect(metrics.recallAt5).toBe(1);
    expect(metrics.mrr).toBe(0.5);
    expect(metrics.symbolHitRate).toBe(1);
  });
});
