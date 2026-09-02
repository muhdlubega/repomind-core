import type { QueryType } from "../../shared/types";

const patterns: Array<[QueryType, RegExp]> = [
  ["testing", /\b(test|tests|spec|coverage|covered by)\b/i],
  ["debugging", /\b(error|exception|bug|fail|stale|race|why might|debug)\b/i],
  ["impact", /\b(impact|affected|depend(?:s|ent|encies)|callers?|references?|change this)\b/i],
  ["architecture", /\b(architecture|explain (?:the )?flow|how does|what happens when|connected|request flow)\b/i],
  ["implementation", /\b(implemented|implementation|where is|find the code|handled)\b/i]
];

export function classifyQuestion(query: string): QueryType {
  for (const [type, pattern] of patterns) if (pattern.test(query)) return type;
  const preciseSymbol = query.match(/\b(?:use[A-Z][A-Za-z0-9_$]*|[A-Z][A-Za-z0-9_$]{2,}|[a-z_$][\w$]*\(\))\b/);
  return preciseSymbol ? "symbol" : "general";
}

export function normalizeQuestion(query: string): string {
  return query.trim().replace(/\s+/g, " ").slice(0, 2_000);
}

export function deterministicRewrite(query: string): string[] {
  const symbols = query.match(/\b[A-Za-z_$][\w$]*\b/g) ?? [];
  const withoutNoise = symbols.filter((term) => !new Set(["where", "what", "which", "does", "this", "that", "from", "with", "into", "about", "explain", "implemented"]).has(term.toLowerCase()));
  return [...new Set([query, withoutNoise.join(" ")])].filter(Boolean).slice(0, 2);
}
