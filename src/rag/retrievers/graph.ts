import type { Relationship, RetrievedCode } from "../../shared/types";
import { toRetrieved, type ChunkRow } from "./common";

export interface GraphOptions { depth: number; relationships?: Relationship[]; limit?: number }

export async function graphSearch(db: D1Database, repositoryId: string, seedChunkIds: string[], options: GraphOptions): Promise<RetrievedCode[]> {
  const maxDepth = Math.min(Math.max(options.depth, 0), 4);
  const limit = Math.min(options.limit ?? 20, 100);
  const seedSymbols = await db.prepare(`SELECT symbol_id FROM chunks WHERE repository_id = ? AND id IN (${seedChunkIds.map(() => "?").join(",") || "NULL"}) AND symbol_id IS NOT NULL`).bind(repositoryId, ...seedChunkIds).all<{ symbol_id: string }>();
  let frontier = new Set(seedSymbols.results.map((row) => row.symbol_id));
  const visited = new Set(frontier);
  const results: RetrievedCode[] = [];
  for (let depth = 1; depth <= maxDepth && frontier.size && results.length < limit; depth += 1) {
    const ids = [...frontier];
    const relationClause = options.relationships?.length ? ` AND d.relationship IN (${options.relationships.map(() => "?").join(",")})` : "";
    const edges = await db.prepare(`SELECT d.relationship, d.source_symbol_id, d.target_symbol_id, c.* FROM dependencies d JOIN chunks c ON c.symbol_id IN (d.source_symbol_id, d.target_symbol_id) WHERE d.repository_id = ? AND (d.source_symbol_id IN (${ids.map(() => "?").join(",")}) OR d.target_symbol_id IN (${ids.map(() => "?").join(",")}))${relationClause} LIMIT ?`).bind(repositoryId, ...ids, ...ids, ...(options.relationships ?? []), limit).all<ChunkRow & { relationship: Relationship; source_symbol_id: string; target_symbol_id: string | null }>();
    frontier = new Set();
    for (const row of edges.results) {
      const symbolId = row.target_symbol_id && ids.includes(row.source_symbol_id) ? row.target_symbol_id : row.source_symbol_id;
      if (!visited.has(symbolId)) { visited.add(symbolId); frontier.add(symbolId); }
      if (!seedChunkIds.includes(row.id) && !results.some((result) => result.id === row.id)) results.push(toRetrieved(row, 1 / (depth + 1), "graph", [`${row.relationship.toLowerCase()} edge`, `depth ${String(depth)}`]));
    }
  }
  return results.slice(0, limit);
}

export async function graphForSymbol(db: D1Database, repositoryId: string, symbolId: string, depth: number): Promise<{ nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }> {
  const bounded = Math.min(Math.max(depth, 1), 4);
  let frontier = new Set([symbolId]);
  const nodes = new Map<string, Record<string, unknown>>();
  const edges = new Map<string, Record<string, unknown>>();
  for (let level = 0; level < bounded && frontier.size; level += 1) {
    const ids = [...frontier];
    const rows = await db.prepare(`SELECT d.*, s.name AS source_name, t.name AS target_symbol_name FROM dependencies d JOIN symbols s ON s.id = d.source_symbol_id LEFT JOIN symbols t ON t.id = d.target_symbol_id WHERE d.repository_id = ? AND (d.source_symbol_id IN (${ids.map(() => "?").join(",")}) OR d.target_symbol_id IN (${ids.map(() => "?").join(",")})) LIMIT 500`).bind(repositoryId, ...ids, ...ids).all<Record<string, string | number | null>>();
    frontier = new Set();
    for (const row of rows.results) {
      const sourceId = String(row.source_symbol_id);
      const targetId = row.target_symbol_id ? String(row.target_symbol_id) : `external:${String(row.target_name)}`;
      nodes.set(sourceId, { id: sourceId, name: row.source_name });
      nodes.set(targetId, { id: targetId, name: row.target_symbol_name ?? row.target_name, external: !row.target_symbol_id });
      edges.set(String(row.id), { id: row.id, source: sourceId, target: targetId, relationship: row.relationship, confidence: row.confidence });
      if (row.target_symbol_id) frontier.add(targetId);
      frontier.add(sourceId);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
