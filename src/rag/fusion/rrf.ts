import type { RetrievedCode } from "../../shared/types";

export interface FusionWeights { lexical: number; semantic: number; graph: number; k: number }
export const defaultFusionWeights: FusionWeights = { lexical: 1.2, semantic: 1, graph: 0.8, k: 60 };

export function reciprocalRankFusion(rankings: RetrievedCode[][], weights: FusionWeights = defaultFusionWeights): RetrievedCode[] {
  const merged = new Map<string, RetrievedCode>();
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((item, rank) => {
      const weight = weights[item.source];
      scores.set(item.id, (scores.get(item.id) ?? 0) + weight / (weights.k + rank + 1));
      const existing = merged.get(item.id);
      if (existing) existing.reasons.push(...item.reasons.filter((reason) => !existing.reasons.includes(reason)));
      else merged.set(item.id, { ...item, reasons: [...item.reasons] });
    });
  }
  return [...merged.values()].map((item) => ({ ...item, score: scores.get(item.id) ?? 0 })).sort((left, right) => right.score - left.score);
}
