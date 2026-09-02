import type { RetrievedCode } from "../../shared/types";
import { chunksByIds, toRetrieved, type ChunkRow } from "./common";

function ftsQuery(query: string): string {
  const tokens = query.match(/[A-Za-z_$][\w$.-]{1,80}/g) ?? [];
  return [...new Set(tokens)].slice(0, 12).map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

export async function lexicalSearch(db: D1Database, repositoryId: string, query: string, limit = 12): Promise<RetrievedCode[]> {
  const exact = await db.prepare("SELECT c.* FROM symbols s JOIN chunks c ON c.symbol_id = s.id WHERE s.repository_id = ? AND lower(s.name) = lower(?) ORDER BY s.exported DESC LIMIT ?").bind(repositoryId, query.replace(/\(\)$/, "").trim(), limit).all<ChunkRow>();
  const results = exact.results.map((row, index) => toRetrieved(row, 1 - index * 0.01, "lexical", ["exact symbol match"]));
  const expression = ftsQuery(query);
  if (!expression) return results;
  const fts = await db.prepare("SELECT chunk_id, bm25(chunks_fts, 0, 0, 3, 1) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? AND repository_id = ? ORDER BY rank LIMIT ?").bind(expression, repositoryId, limit).all<{ chunk_id: string; rank: number }>();
  const rows = await chunksByIds(db, repositoryId, fts.results.map((row) => row.chunk_id));
  for (const [index, match] of fts.results.entries()) {
    if (results.some((result) => result.id === match.chunk_id)) continue;
    const row = rows.get(match.chunk_id);
    if (row) results.push(toRetrieved(row, 1 / (1 + Math.max(0, match.rank)) - index * 0.001, "lexical", ["full-text match"]));
  }
  return results.slice(0, limit);
}
