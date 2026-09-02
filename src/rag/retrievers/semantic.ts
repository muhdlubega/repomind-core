import { z } from "zod";
import type { RetrievedCode } from "../../shared/types";
import { embedTexts } from "../../indexing/embeddings/workers-ai";
import { chunksByIds, toRetrieved } from "./common";

const metadataSchema = z.object({ repositoryId: z.string(), chunkId: z.string(), path: z.string().optional() });

export async function semanticSearch(env: Env, embeddingModel: string, repositoryId: string, query: string, limit = 12): Promise<RetrievedCode[]> {
  const [vector] = await embedTexts(env.AI, embeddingModel, [query]);
  if (!vector) return [];
  const matches = await env.CODE_INDEX.query(vector, { topK: limit, namespace: repositoryId, returnMetadata: "all" });
  const safe = matches.matches.flatMap((match) => {
    const parsed = metadataSchema.safeParse(match.metadata);
    return parsed.success && parsed.data.repositoryId === repositoryId ? [{ chunkId: parsed.data.chunkId, score: match.score }] : [];
  });
  const rows = await chunksByIds(env.DB, repositoryId, safe.map((match) => match.chunkId));
  return safe.flatMap((match) => {
    const row = rows.get(match.chunkId);
    return row ? [toRetrieved(row, match.score, "semantic", ["embedding similarity"])] : [];
  });
}
