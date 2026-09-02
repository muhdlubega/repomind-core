import type { RuntimeConfig } from "../shared/env";
import type { SearchStrategy } from "../rag/search";
import { searchRepository } from "../rag/search";
import { calculateRetrievalMetrics, type EvaluationCaseResult } from "./metrics/retrieval";

interface CaseRow { question: string; expected_files_json: string; expected_symbols_json: string }
function strings(value: string): string[] { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }

export async function runEvaluation(env: Env, config: RuntimeConfig, repositoryId: string, strategy: SearchStrategy, runId: string): Promise<void> {
  const cases = await env.DB.prepare("SELECT question, expected_files_json, expected_symbols_json FROM evaluation_cases WHERE repository_id = ?").bind(repositoryId).all<CaseRow>();
  const results: EvaluationCaseResult[] = [];
  for (const evaluationCase of cases.results) {
    const retrieved = await searchRepository(env, config, repositoryId, evaluationCase.question, strategy, 10);
    results.push({ rankedFiles: [...new Set(retrieved.map((item) => item.path))], rankedSymbols: [...new Set(retrieved.flatMap((item) => item.symbol ? [item.symbol] : []))], expectedFiles: strings(evaluationCase.expected_files_json), expectedSymbols: strings(evaluationCase.expected_symbols_json) });
  }
  const metrics = calculateRetrievalMetrics(results);
  await env.DB.prepare("UPDATE evaluation_runs SET status = 'completed', metrics_json = ?, completed_at = datetime('now') WHERE id = ?").bind(JSON.stringify({ ...metrics, cases: results.length }), runId).run();
}
