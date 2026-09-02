import { describe, expect, it } from "vitest";
import { chunkParsedFile } from "../../src/indexing/chunking/ast-chunker";

describe("AST-aware chunking", () => {
  it("uses symbol boundaries and stable hashes", async () => {
    const content = "export function login() {\n  return true;\n}";
    const parsed = { symbols: [{ name: "login", qualifiedName: "src/auth.ts:login", type: "function", signature: "export function login()", startLine: 1, endLine: 3, exported: true }], imports: [], exports: ["login"], dependencies: [] };
    const first = await chunkParsedFile("repo", "sha", "src/auth.ts", "typescript", content, parsed);
    const second = await chunkParsedFile("repo", "sha", "src/auth.ts", "typescript", content, parsed);
    expect(first[0]?.metadata).toMatchObject({ symbol: "login", startLine: 1, endLine: 3 });
    expect(first[0]?.metadata.contentHash).toBe(second[0]?.metadata.contentHash);
  });

  it("splits large symbols with overlap while retaining parent metadata", async () => {
    const content = Array.from({ length: 400 }, (_, index) => `line${String(index + 1)}`).join("\n");
    const parsed = { symbols: [{ name: "Huge", qualifiedName: "x:Huge", type: "class", signature: "class Huge", startLine: 1, endLine: 400, exported: true }], imports: [], exports: ["Huge"], dependencies: [] };
    const chunks = await chunkParsedFile("repo", "sha", "x.ts", "typescript", content, parsed);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.metadata.symbol === "Huge")).toBe(true);
    expect(chunks[1]?.metadata.startLine).toBeLessThan((chunks[0]?.metadata.endLine ?? 0) + 1);
  });
});
