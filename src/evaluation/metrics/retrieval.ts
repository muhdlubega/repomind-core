export interface EvaluationCaseResult { rankedFiles: string[]; rankedSymbols: string[]; expectedFiles: string[]; expectedSymbols: string[] }
export interface RetrievalMetrics { recallAt1: number; recallAt5: number; recallAt10: number; mrr: number; ndcg: number; fileHitRate: number; symbolHitRate: number }

function mean(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }
function recallAt(ranked: string[], expected: string[], k: number): number {
  if (!expected.length) return 1;
  const found = new Set(ranked.slice(0, k));
  return expected.filter((item) => found.has(item)).length / expected.length;
}
function reciprocalRank(ranked: string[], expected: string[]): number {
  const expectedSet = new Set(expected);
  const index = ranked.findIndex((item) => expectedSet.has(item));
  return index < 0 ? 0 : 1 / (index + 1);
}
function ndcgAt10(ranked: string[], expected: string[]): number {
  if (!expected.length) return 1;
  const expectedSet = new Set(expected);
  const dcg = ranked.slice(0, 10).reduce((sum, item, index) => sum + (expectedSet.has(item) ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(10, expected.length) }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
  return ideal ? dcg / ideal : 0;
}

export function calculateRetrievalMetrics(results: EvaluationCaseResult[]): RetrievalMetrics {
  const fileExpected = results.filter((result) => result.expectedFiles.length);
  const symbolExpected = results.filter((result) => result.expectedSymbols.length);
  return {
    recallAt1: mean(results.map((result) => recallAt(result.rankedFiles, result.expectedFiles, 1))),
    recallAt5: mean(results.map((result) => recallAt(result.rankedFiles, result.expectedFiles, 5))),
    recallAt10: mean(results.map((result) => recallAt(result.rankedFiles, result.expectedFiles, 10))),
    mrr: mean(results.map((result) => reciprocalRank(result.rankedFiles, result.expectedFiles))),
    ndcg: mean(results.map((result) => ndcgAt10(result.rankedFiles, result.expectedFiles))),
    fileHitRate: mean(fileExpected.map((result) => recallAt(result.rankedFiles, result.expectedFiles, result.rankedFiles.length) > 0 ? 1 : 0)),
    symbolHitRate: mean(symbolExpected.map((result) => recallAt(result.rankedSymbols, result.expectedSymbols, result.rankedSymbols.length) > 0 ? 1 : 0))
  };
}
