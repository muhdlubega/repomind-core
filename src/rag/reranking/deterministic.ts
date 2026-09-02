import type { RetrievedCode } from "../../shared/types";

export interface Reranker { rerank(query: string, results: RetrievedCode[]): Promise<RetrievedCode[]> }

function identifiers(query: string): Set<string> {
  return new Set((query.match(/[A-Za-z_$][\w$]*/g) ?? []).map((value) => value.toLowerCase()));
}

export class DeterministicCodeReranker implements Reranker {
  rerank(query: string, results: RetrievedCode[]): Promise<RetrievedCode[]> {
    const terms = identifiers(query);
    const testing = /\b(tests?|specs?|coverage)\b/i.test(query);
    return Promise.resolve(results.map((item) => {
      let boost = 0;
      const symbol = item.symbol?.toLowerCase();
      if (symbol && terms.has(symbol)) { boost += 0.08; item.reasons.push("exact symbol boost"); }
      const basename = item.path.split("/").at(-1)?.replace(/\.[^.]+$/, "").toLowerCase();
      if (basename && terms.has(basename)) { boost += 0.05; item.reasons.push("file-name boost"); }
      if (testing && /(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|\.)|\.(?:test|spec)\./i.test(item.path)) { boost += 0.04; item.reasons.push("test-file boost"); }
      if (item.reasons.some((reason) => /exact|definition/i.test(reason))) boost += 0.03;
      return { ...item, score: item.score + boost };
    }).sort((left, right) => right.score - left.score));
  }
}
