import type { Citation, RetrievedCode } from "../../shared/types";

export function retrievalConfidence(results: RetrievedCode[], context: RetrievedCode[], citations: Citation[]): number {
  if (!results.length || !context.length) return 0;
  const normalizedScore = Math.min(1, results.slice(0, 5).reduce((sum, result) => sum + Math.min(result.score * 12, 1), 0) / Math.min(5, results.length));
  const agreement = context.filter((item) => item.reasons.length > 1).length / context.length;
  const exact = context.some((item) => item.reasons.some((reason) => reason.includes("exact"))) ? 1 : 0;
  const sourceDiversity = Math.min(1, new Set(context.map((item) => item.path)).size / 3);
  const citationCoverage = Math.min(1, citations.length / Math.min(3, context.length));
  return Math.round((normalizedScore * 0.35 + agreement * 0.2 + exact * 0.15 + sourceDiversity * 0.1 + citationCoverage * 0.2) * 100) / 100;
}
