import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../../src/rag/fusion/rrf";
import { DeterministicCodeReranker } from "../../src/rag/reranking/deterministic";
import { buildContext } from "../../src/rag/context/builder";
import type { RetrievedCode } from "../../src/shared/types";

function chunk(id: string, path: string, source: RetrievedCode["source"], symbol?: string, startLine = 1, endLine = 10): RetrievedCode {
  return { id, fileId: `file-${id}`, repositoryId: "repo", commitSha: "sha", path, language: "typescript", startLine, endLine, contentHash: `${id}-${String(startLine)}`, content: `function ${symbol ?? id}() {}`, score: 0.5, source, reasons: [source], ...(symbol ? { symbol } : {}) };
}

describe("hybrid retrieval", () => {
  it("RRF rewards agreement across retrievers", () => {
    const sharedLexical = chunk("shared", "src/auth.ts", "lexical", "authenticate");
    const sharedSemantic = chunk("shared", "src/auth.ts", "semantic", "authenticate");
    const fused = reciprocalRankFusion([[sharedLexical, chunk("lex", "src/a.ts", "lexical")], [chunk("sem", "src/b.ts", "semantic"), sharedSemantic]]);
    expect(fused[0]?.id).toBe("shared");
    expect(fused[0]?.reasons).toEqual(expect.arrayContaining(["lexical", "semantic"]));
  });

  it("deterministic reranking boosts exact symbols and tests", async () => {
    const reranked = await new DeterministicCodeReranker().rerank("Which tests cover authenticate?", [chunk("impl", "src/auth.ts", "lexical", "authenticate"), chunk("test", "test/auth.test.ts", "semantic", "authTest")]);
    expect(reranked.some((item) => item.reasons.includes("exact symbol boost"))).toBe(true);
    expect(reranked.some((item) => item.reasons.includes("test-file boost"))).toBe(true);
  });

  it("context builder removes overlaps and preserves file diversity", () => {
    const results = [chunk("a", "src/auth.ts", "lexical", "auth", 1, 20), chunk("b", "src/auth.ts", "semantic", "auth", 2, 19), chunk("c", "src/db.ts", "graph", "db", 1, 10)];
    const context = buildContext(results, { maxTokens: 1000, maxChunks: 10, maxPerFile: 2 });
    expect(context.map((item) => item.id)).toEqual(["a", "c"]);
  });
});
