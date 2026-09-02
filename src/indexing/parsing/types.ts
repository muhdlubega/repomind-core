import type { Relationship } from "../../shared/types";

export interface ParsedSymbol {
  name: string;
  qualifiedName: string;
  type: string;
  signature: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  parentSymbol?: string;
}
export interface ParsedDependency { sourceName: string; targetName: string; relationship: Relationship; confidence: number }
export interface ParsedFile { symbols: ParsedSymbol[]; imports: string[]; exports: string[]; dependencies: ParsedDependency[] }

export interface CodeParser { parse(path: string, language: string, content: string): Promise<ParsedFile> }
