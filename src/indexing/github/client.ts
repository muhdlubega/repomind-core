import { z } from "zod";
import { AppError } from "../../shared/errors";

const repositorySchema = z.object({ default_branch: z.string(), size: z.number().nonnegative(), private: z.boolean() });
const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/i) });
const treeSchema = z.object({ truncated: z.boolean(), tree: z.array(z.object({ path: z.string(), mode: z.string(), type: z.string(), sha: z.string(), size: z.number().optional() })) });

async function boundedJson(response: Response, maxBytes = 12_000_000): Promise<unknown> {
  if (!response.ok) throw new AppError("GITHUB_REQUEST_FAILED", `GitHub returned ${String(response.status)}.`, response.status === 404 ? 404 : 502);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new AppError("GITHUB_RESPONSE_TOO_LARGE", "GitHub metadata exceeded the safe response limit.", 413);
  if (!response.body) throw new AppError("GITHUB_EMPTY_RESPONSE", "GitHub returned an empty response.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let read = await reader.read();
  while (!read.done) {
    total += read.value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new AppError("GITHUB_RESPONSE_TOO_LARGE", "GitHub metadata exceeded the safe response limit.", 413); }
    chunks.push(read.value);
    read = await reader.read();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(merged));
}

export interface GitHubTreeFile { path: string; sha: string; size: number }
export interface GitHubSnapshot { defaultBranch: string; commitSha: string; files: GitHubTreeFile[] }

function safeRepositoryPath(path: string): boolean {
  const parts = path.split("/");
  return path.length <= 1000 && !path.startsWith("/") && !path.includes("\0") && parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export class GitHubClient {
  constructor(private readonly token?: string) {}

  private headers(): HeadersInit {
    return { Accept: "application/vnd.github+json", "User-Agent": "CodeLensa-Core", "X-GitHub-Api-Version": "2022-11-28", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) };
  }
  private api(owner: string, repo: string, suffix = ""): string {
    return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
  }

  async snapshot(owner: string, repo: string): Promise<GitHubSnapshot> {
    const metadata = repositorySchema.parse(await boundedJson(await fetch(this.api(owner, repo), { headers: this.headers(), signal: AbortSignal.timeout(20_000) })));
    if (metadata.private) throw new AppError("PUBLIC_REPOSITORY_REQUIRED", "Only public GitHub repositories can be linked.", 400);
    const commit = commitSchema.parse(await boundedJson(await fetch(this.api(owner, repo, `/commits/${encodeURIComponent(metadata.default_branch)}`), { headers: this.headers(), signal: AbortSignal.timeout(20_000) })));
    const tree = treeSchema.parse(await boundedJson(await fetch(this.api(owner, repo, `/git/trees/${commit.sha}?recursive=1`), { headers: this.headers(), signal: AbortSignal.timeout(20_000) })));
    if (tree.truncated) throw new AppError("REPOSITORY_TREE_TRUNCATED", "This repository is too large for safe recursive indexing.", 413);
    return { defaultBranch: metadata.default_branch, commitSha: commit.sha, files: tree.tree.filter((entry) => entry.type === "blob" && entry.mode !== "120000" && safeRepositoryPath(entry.path)).map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size ?? 0 })) };
  }

  async file(owner: string, repo: string, commit: string, path: string, maxBytes: number): Promise<Uint8Array> {
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(url, { headers: { "User-Agent": "CodeLensa-Core" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !response.body) throw new AppError("GITHUB_FILE_FAILED", `Could not read ${path} (HTTP ${String(response.status)}).`, 502);
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new AppError("FILE_TOO_LARGE", "File exceeds the indexing limit.", 413);
        parts.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return bytes;
  }
}
