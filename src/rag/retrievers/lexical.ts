import type { RetrievedCode } from "../../shared/types";
import { chunksByIds, toRetrieved, type ChunkRow } from "./common";

function ftsQuery(query: string): string {
  const stopwords = new Set("what how does do is are the a an this that it of in to for and with can you me tell about project repository code work".split(" "));
  const tokens = (query.match(/[A-Za-z_$][\w$.-]{1,80}/g) ?? []).filter(token => !stopwords.has(token.toLowerCase()));
  return [...new Set(tokens)].slice(0, 12).map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

export async function lexicalSearch(db: D1Database, repositoryId: string, query: string, limit = 12): Promise<RetrievedCode[]> {
  const exact = await db.prepare("SELECT c.* FROM symbols s JOIN chunks c ON c.symbol_id = s.id WHERE s.repository_id = ? AND lower(s.name) = lower(?) ORDER BY s.exported DESC LIMIT ?").bind(repositoryId, query.replace(/\(\)$/, "").trim(), limit).all<ChunkRow>();
  const results = exact.results.map((row, index) => toRetrieved(row, 1 - index * 0.01, "lexical", ["exact symbol match"]));
  const expression = ftsQuery(query);
  if (!expression || /\b(overview|purpose|what .* (do|about)|getting started)\b/i.test(query)) {
    const overview = await db.prepare("SELECT * FROM chunks WHERE repository_id = ? AND (lower(path) LIKE '%readme%' OR path IN ('package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod')) ORDER BY CASE WHEN lower(path) LIKE '%readme%' THEN 0 ELSE 1 END, start_line LIMIT ?").bind(repositoryId, limit).all<ChunkRow>();
    results.push(...overview.results.map(row => toRetrieved(row, 0.9, "lexical", ["repository overview"])));
    if (!expression) return results.slice(0, limit);
  }
  const fts = await db.prepare("SELECT chunk_id, bm25(chunks_fts, 0, 0, 3, 1) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? AND repository_id = ? ORDER BY rank LIMIT ?").bind(expression, repositoryId, limit).all<{ chunk_id: string; rank: number }>();
  const rows = await chunksByIds(db, repositoryId, fts.results.map((row) => row.chunk_id));
  for (const [index, match] of fts.results.entries()) {
    if (results.some((result) => result.id === match.chunk_id)) continue;
    const row = rows.get(match.chunk_id);
    if (row) results.push(toRetrieved(row, 1 / (1 + Math.max(0, match.rank)) - index * 0.001, "lexical", ["full-text match"]));
  }
  return results.slice(0, limit);
}
