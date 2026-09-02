import { Parser, Language, type Node as SyntaxNode } from "web-tree-sitter";
import type { CodeParser, ParsedFile, ParsedSymbol } from "./types";
import { StructuralCodeParser } from "./structural-parser";

const grammarKeys: Readonly<Record<string, string>> = {
  typescript: "grammars/tree-sitter-typescript.wasm",
  tsx: "grammars/tree-sitter-tsx.wasm",
  javascript: "grammars/tree-sitter-javascript.wasm",
  jsx: "grammars/tree-sitter-javascript.wasm",
  python: "grammars/tree-sitter-python.wasm"
};
const namedTypes = new Set(["function_declaration", "method_definition", "class_declaration", "interface_declaration", "type_alias_declaration", "lexical_declaration", "function_definition", "class_definition"]);

function nodeName(node: SyntaxNode, content: string): string | null {
  const name = node.childForFieldName("name");
  if (name) return content.slice(name.startIndex, name.endIndex);
  const declarator = node.namedChildren[0]?.childForFieldName("name");
  return declarator ? content.slice(declarator.startIndex, declarator.endIndex) : null;
}

export class TreeSitterCodeParser implements CodeParser {
  private constructor(private readonly parser: Parser, private readonly fallback: StructuralCodeParser) {}

  static async create(bucket: R2Bucket, language: string): Promise<CodeParser> {
    const fallback = new StructuralCodeParser();
    const key = grammarKeys[language];
    if (!key) return fallback;
    const [runtime, grammar] = await Promise.all([bucket.get("grammars/web-tree-sitter.wasm"), bucket.get(key)]);
    if (!runtime || !grammar) return fallback;
    try {
      await Parser.init({ wasmBinary: new Uint8Array(await runtime.arrayBuffer()) });
      const parser = new Parser();
      parser.setLanguage(await Language.load(new Uint8Array(await grammar.arrayBuffer())));
      return new TreeSitterCodeParser(parser, fallback);
    } catch (error) {
      console.error(JSON.stringify({ message: "tree-sitter initialization failed; using structural fallback", language, error: error instanceof Error ? error.message : String(error) }));
      return fallback;
    }
  }

  async parse(path: string, language: string, content: string): Promise<ParsedFile> {
    const baseline = await this.fallback.parse(path, language, content);
    const tree = this.parser.parse(content);
    if (!tree) return baseline;
    const symbols: ParsedSymbol[] = [];
    const visit = (node: SyntaxNode, parent?: string): void => {
      let nextParent = parent;
      if (namedTypes.has(node.type)) {
        const name = nodeName(node, content);
        if (name) {
          const signature = content.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 500)).split("\n")[0] ?? name;
          symbols.push({ name, qualifiedName: parent ? `${path}:${parent}.${name}` : `${path}:${name}`, type: node.type, signature, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, exported: /export\s/.test(content.slice(Math.max(0, node.startIndex - 20), node.startIndex)), ...(parent ? { parentSymbol: parent } : {}) });
          nextParent = name;
        }
      }
      for (const child of node.namedChildren) if (child) visit(child, nextParent);
    };
    visit(tree.rootNode);
    tree.delete();
    return symbols.length ? { ...baseline, symbols } : baseline;
  }
}
