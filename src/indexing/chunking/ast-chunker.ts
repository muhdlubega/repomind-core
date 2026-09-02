import type { CodeChunkMetadata } from "../../shared/types";
import type { ParsedFile, ParsedSymbol } from "../parsing/types";

export interface GeneratedChunk { metadata: CodeChunkMetadata; content: string; tokenEstimate: number }
const MAX_CHUNK_LINES = 180;
const OVERLAP_LINES = 12;

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function chunksForSymbol(base: Omit<CodeChunkMetadata, "startLine" | "endLine" | "contentHash">, lines: string[], symbol: ParsedSymbol): Promise<GeneratedChunk[]> {
  const output: GeneratedChunk[] = [];
  for (let start = symbol.startLine; start <= symbol.endLine; start += MAX_CHUNK_LINES - OVERLAP_LINES) {
    const end = Math.min(symbol.endLine, start + MAX_CHUNK_LINES - 1);
    const content = lines.slice(start - 1, end).join("\n");
    output.push({ metadata: { ...base, symbol: symbol.name, symbolType: symbol.type, startLine: start, endLine: end, contentHash: await sha256(content), ...(symbol.parentSymbol ? { parentSymbol: symbol.parentSymbol } : {}) }, content, tokenEstimate: Math.ceil(content.length / 4) });
    if (end === symbol.endLine) break;
  }
  return output;
}

export async function chunkParsedFile(repositoryId: string, commitSha: string, path: string, language: string, content: string, parsed: ParsedFile): Promise<GeneratedChunk[]> {
  const lines = content.split(/\r?\n/);
  const base = { repositoryId, commitSha, path, language, imports: parsed.imports, exports: parsed.exports };
  const chunks = (await Promise.all(parsed.symbols.map((symbol) => chunksForSymbol(base, lines, symbol)))).flat();
  if (chunks.length) return chunks;
  const contentHash = await sha256(content);
  return [{ metadata: { ...base, startLine: 1, endLine: Math.max(1, lines.length), contentHash }, content, tokenEstimate: Math.ceil(content.length / 4) }];
}
