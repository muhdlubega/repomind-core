import type { RetrievedCode } from "../../shared/types";

export interface ChunkRow { id: string; file_id: string; repository_id: string; commit_sha: string; path: string; language: string; symbol: string | null; symbol_type: string | null; parent_symbol: string | null; start_line: number; end_line: number; imports_json: string; exports_json: string; content_hash: string; content: string }

function stringArray(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}

export function toRetrieved(row: ChunkRow, score: number, source: RetrievedCode["source"], reasons: string[]): RetrievedCode {
  return {
    id: row.id,
    fileId: row.file_id,
    repositoryId: row.repository_id,
    commitSha: row.commit_sha,
    path: row.path,
    language: row.language,
    startLine: row.start_line,
    endLine: row.end_line,
    contentHash: row.content_hash,
    content: row.content,
    score,
    source,
    reasons,
    imports: stringArray(row.imports_json),
    exports: stringArray(row.exports_json),
    ...(row.symbol ? { symbol: row.symbol } : {}),
    ...(row.symbol_type ? { symbolType: row.symbol_type } : {}),
    ...(row.parent_symbol ? { parentSymbol: row.parent_symbol } : {})
  };
}

export async function chunksByIds(db: D1Database, repositoryId: string, ids: string[]): Promise<Map<string, ChunkRow>> {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.prepare(`SELECT * FROM chunks WHERE repository_id = ? AND id IN (${placeholders})`).bind(repositoryId, ...ids).all<ChunkRow>();
  return new Map(rows.results.map((row) => [row.id, row]));
}
