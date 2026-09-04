const ignoredDirectories = new Set(["node_modules", ".next", "dist", "build", "coverage", ".git", "vendor", "target", "__pycache__"]);
const ignoredBasenames = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Cargo.lock"]);
const supportedExtensions = new Map([[".ts", "typescript"], [".tsx", "tsx"], [".js", "javascript"], [".jsx", "jsx"], [".py", "python"], [".md", "markdown"], [".mdx", "markdown"], [".txt", "text"], [".json", "json"], [".yaml", "yaml"], [".yml", "yaml"], [".toml", "toml"], [".go", "go"], [".rs", "rust"], [".java", "java"], [".kt", "kotlin"], [".cs", "csharp"], [".cpp", "cpp"], [".c", "c"], [".h", "c"], [".php", "php"], [".rb", "ruby"], [".swift", "swift"], [".sql", "sql"], [".html", "html"], [".css", "css"], [".sh", "shell"], [".vue", "vue"], [".svelte", "svelte"]]);

export function languageForPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((part) => ignoredDirectories.has(part)) || ignoredBasenames.has(segments.at(-1) ?? "") || /\.min\.js$/i.test(normalized)) return null;
  if (/^(dockerfile|readme|makefile)$/i.test(segments.at(-1) ?? "")) return "text";
  for (const [extension, language] of supportedExtensions) if (normalized.toLowerCase().endsWith(extension)) return language;
  return null;
}

export function isProbablyBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8_192);
  for (let index = 0; index < limit; index += 1) if (bytes[index] === 0) return true;
  return false;
}

export function containsPromptInjection(text: string): boolean {
  return /(ignore (all |the )?(previous|system) instructions|system prompt|you are chatgpt|developer message)/i.test(text);
}
