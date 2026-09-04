import { describe, expect, it } from "vitest";
import { chunkParsedFile } from "../../src/indexing/chunking/ast-chunker";

describe("AST-aware chunking", () => {
  it("indexes an entire unparsed document in overlapping passages with real line ranges", async () => {
    const lines = Array.from({ length: 350 }, (_, i) => `documentation line ${String(i + 1)}`);
    const chunks = await chunkParsedFile("repo", "sha", "README.md", "markdown", lines.join("\n"), { symbols: [], imports: [], exports: [], dependencies: [] });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.at(-1)?.metadata.endLine).toBe(350);
    for (const chunk of chunks) expect(chunk.content).toBe(lines.slice(chunk.metadata.startLine - 1, chunk.metadata.endLine).join("\n"));
  });
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
