import type { RetrievedCode } from "../../shared/types";

export interface ContextOptions { maxTokens: number; maxChunks: number; maxPerFile: number }
export const defaultContextOptions: ContextOptions = { maxTokens: 8_000, maxChunks: 16, maxPerFile: 4 };

function overlap(left: RetrievedCode, right: RetrievedCode): number {
  if (left.path !== right.path) return 0;
  const intersection = Math.max(0, Math.min(left.endLine, right.endLine) - Math.max(left.startLine, right.startLine) + 1);
  return intersection / Math.max(1, Math.min(left.endLine - left.startLine + 1, right.endLine - right.startLine + 1));
}

export function buildContext(results: RetrievedCode[], options: ContextOptions = defaultContextOptions): RetrievedCode[] {
  const selected: RetrievedCode[] = [];
  const perFile = new Map<string, number>();
  let tokens = 0;
  for (const result of results) {
    if (selected.length >= options.maxChunks || (perFile.get(result.path) ?? 0) >= options.maxPerFile) continue;
    if (selected.some((existing) => existing.contentHash === result.contentHash || overlap(existing, result) > 0.8)) continue;
    const estimate = Math.ceil(result.content.length / 4) + 40;
    if (tokens + estimate > options.maxTokens && selected.length) continue;
    selected.push(result);
    tokens += estimate;
    perFile.set(result.path, (perFile.get(result.path) ?? 0) + 1);
  }
  return selected;
}
