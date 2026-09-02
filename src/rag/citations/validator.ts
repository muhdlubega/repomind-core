import type { Citation, RetrievedCode } from "../../shared/types";

const inlineCitation = /\[chunk:([0-9a-f-]{20,})\]/gi;

export function citationsFromAnswer(answer: string, context: RetrievedCode[]): Citation[] {
  const byId = new Map(context.map((chunk) => [chunk.id, chunk]));
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const match of answer.matchAll(inlineCitation)) {
    const chunkId = match[1];
    if (!chunkId || seen.has(chunkId)) continue;
    const chunk = byId.get(chunkId);
    if (!chunk) continue;
    seen.add(chunkId);
    citations.push({ id: crypto.randomUUID(), fileId: chunk.fileId, path: chunk.path, startLine: chunk.startLine, endLine: chunk.endLine, chunkId: chunk.id, ...(chunk.symbol ? { symbol: chunk.symbol } : {}) });
  }
  return citations;
}

export interface CitationValidation { valid: Citation[]; invalid: Citation[]; validity: number }

export async function validateCitations(db: D1Database, repositoryId: string, citations: Citation[], context: RetrievedCode[]): Promise<CitationValidation> {
  const allowed = new Set(context.map((chunk) => chunk.id));
  const valid: Citation[] = [];
  const invalid: Citation[] = [];
  for (const citation of citations) {
    if (!allowed.has(citation.chunkId)) { invalid.push(citation); continue; }
    const row = await db.prepare("SELECT c.id, c.file_id, c.path, c.start_line, c.end_line, f.line_count FROM chunks c JOIN files f ON f.id = c.file_id WHERE c.id = ? AND c.file_id = ? AND c.repository_id = ? AND f.repository_id = ?").bind(citation.chunkId, citation.fileId, repositoryId, repositoryId).first<{ id: string; file_id: string; path: string; start_line: number; end_line: number; line_count: number }>();
    if (!row || citation.path !== row.path || citation.startLine < row.start_line || citation.endLine > row.end_line || citation.startLine < 1 || citation.endLine > row.line_count || citation.endLine < citation.startLine) invalid.push(citation);
    else valid.push(citation);
  }
  return { valid, invalid, validity: citations.length ? valid.length / citations.length : 0 };
}
