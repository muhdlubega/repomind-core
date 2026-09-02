import type { CodeParser, ParsedDependency, ParsedFile, ParsedSymbol } from "./types";

interface MatchDefinition { line: number; indent: number; name: string; type: string; signature: string; exported: boolean }

const jsDefinition = /^(\s*)(export\s+)?(?:default\s+)?(?:(async)\s+)?(?:(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/;
const pyDefinition = /^(\s*)(?:(async)\s+)?(def|class)\s+([A-Za-z_][\w]*)\s*(?:\([^)]*\))?\s*:/;

function definitions(lines: string[], language: string): MatchDefinition[] {
  const found: MatchDefinition[] = [];
  lines.forEach((line, index) => {
    if (language === "python") {
      const match = pyDefinition.exec(line);
      if (!match) return;
      found.push({ line: index, indent: match[1]?.length ?? 0, name: match[4] ?? "anonymous", type: match[3] === "class" ? "class" : "function", signature: line.trim(), exported: !line.startsWith("_") });
      return;
    }
    const match = jsDefinition.exec(line);
    if (!match) return;
    const kind = match[4] ?? (/^[\s]*(?:export\s+)?const\s+use[A-Z]/.test(line) ? "hook" : /^[\s]*(?:export\s+)?const\s+[A-Z]/.test(line) ? "component" : "function");
    found.push({ line: index, indent: match[1]?.length ?? 0, name: match[5] ?? match[6] ?? "anonymous", type: kind, signature: line.trim(), exported: Boolean(match[2]) });
  });
  return found;
}

function findEnd(lines: string[], definition: MatchDefinition, language: string, next?: MatchDefinition): number {
  if (language === "python") {
    for (let index = definition.line + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line?.trim() && (line.match(/^\s*/)?.[0].length ?? 0) <= definition.indent) return index - 1;
    }
    return lines.length - 1;
  }
  let depth = 0;
  let opened = false;
  for (let index = definition.line; index < lines.length; index += 1) {
    const clean = (lines[index] ?? "").replace(/(['"`]).*?\1/g, "").replace(/\/\/.*$/, "");
    for (const char of clean) {
      if (char === "{") { depth += 1; opened = true; }
      if (char === "}") depth -= 1;
    }
    if (opened && depth <= 0) return index;
  }
  return (next?.line ?? lines.length) - 1;
}

function parseImports(content: string, language: string): string[] {
  const matches = language === "python"
    ? [...content.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)].map((match) => match[1] ?? match[2])
    : [...content.matchAll(/(?:import[\s\S]*?from\s*|require\s*\()\s*["']([^"']+)["']/g)].map((match) => match[1]);
  return [...new Set(matches.filter((value): value is string => Boolean(value)))];
}

function parseDependencies(symbols: ParsedSymbol[], imports: string[], content: string): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];
  for (const symbol of symbols) {
    const body = content.split("\n").slice(symbol.startLine - 1, symbol.endLine).join("\n");
    for (const imported of imports) dependencies.push({ sourceName: symbol.name, targetName: imported, relationship: "IMPORTS", confidence: 0.95 });
    const calls = [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]).filter((name): name is string => Boolean(name) && name !== symbol.name);
    for (const call of [...new Set(calls)].slice(0, 100)) dependencies.push({ sourceName: symbol.name, targetName: call, relationship: "CALLS", confidence: 0.65 });
    const inheritance = symbol.signature.match(/(?:extends|implements)\s+([A-Za-z_$][\w$]*)/g) ?? [];
    for (const clause of inheritance) {
      const [relationship, targetName] = clause.split(/\s+/);
      if (targetName) dependencies.push({ sourceName: symbol.name, targetName, relationship: relationship === "extends" ? "EXTENDS" : "IMPLEMENTS", confidence: 0.95 });
    }
  }
  return dependencies;
}

export class StructuralCodeParser implements CodeParser {
  parse(path: string, language: string, content: string): Promise<ParsedFile> {
    const lines = content.split(/\r?\n/);
    const matches = definitions(lines, language);
    const symbols: ParsedSymbol[] = matches.map((definition, index) => {
      const parent = matches.slice(0, index).reverse().find((candidate) => candidate.indent < definition.indent && findEnd(lines, candidate, language) >= definition.line);
      return {
        name: definition.name,
        qualifiedName: parent ? `${path}:${parent.name}.${definition.name}` : `${path}:${definition.name}`,
        type: definition.type,
        signature: definition.signature.slice(0, 500),
        startLine: definition.line + 1,
        endLine: findEnd(lines, definition, language, matches[index + 1]) + 1,
        exported: definition.exported,
        ...(parent ? { parentSymbol: parent.name } : {})
      };
    });
    const imports = parseImports(content, language);
    const exports = symbols.filter((symbol) => symbol.exported).map((symbol) => symbol.name);
    return Promise.resolve({ symbols, imports, exports, dependencies: parseDependencies(symbols, imports, content) });
  }
}
