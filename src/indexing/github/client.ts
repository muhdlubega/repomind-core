import { z } from "zod";
import { AppError } from "../../shared/errors";

const repositorySchema = z.object({ default_branch: z.string(), size: z.number().nonnegative() });
const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/i) });
const treeSchema = z.object({ truncated: z.boolean(), tree: z.array(z.object({ path: z.string(), mode: z.string(), type: z.string(), sha: z.string(), size: z.number().optional() })) });
const blobSchema = z.object({ encoding: z.literal("base64"), content: z.string(), size: z.number() });

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
    const metadata = repositorySchema.parse(await boundedJson(await fetch(this.api(owner, repo), { headers: this.headers() })));
    const commit = commitSchema.parse(await boundedJson(await fetch(this.api(owner, repo, `/commits/${encodeURIComponent(metadata.default_branch)}`), { headers: this.headers() })));
    const tree = treeSchema.parse(await boundedJson(await fetch(this.api(owner, repo, `/git/trees/${commit.sha}?recursive=1`), { headers: this.headers() })));
    if (tree.truncated) throw new AppError("REPOSITORY_TREE_TRUNCATED", "This repository is too large for safe recursive indexing.", 413);
    return { defaultBranch: metadata.default_branch, commitSha: commit.sha, files: tree.tree.filter((entry) => entry.type === "blob" && entry.mode !== "120000" && safeRepositoryPath(entry.path)).map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size ?? 0 })) };
  }

  async file(owner: string, repo: string, sha: string, maxBytes: number): Promise<Uint8Array> {
    const blob = blobSchema.parse(await boundedJson(await fetch(this.api(owner, repo, `/git/blobs/${encodeURIComponent(sha)}`), { headers: this.headers() }), Math.ceil(maxBytes * 1.5) + 10_000));
    if (blob.size > maxBytes) throw new AppError("FILE_TOO_LARGE", "Repository file exceeded the indexing limit.", 413);
    const binary = atob(blob.content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength > maxBytes) throw new AppError("FILE_TOO_LARGE", "Repository file exceeded the indexing limit.", 413);
    return bytes;
  }
}
