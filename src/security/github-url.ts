import { z } from "zod";
import { AppError } from "../shared/errors";

const segment = /^[A-Za-z0-9_.-]{1,100}$/;
const inputSchema = z.string().url().max(500);

export interface GitHubRepositoryRef { url: string; owner: string; repo: string }

export function parsePublicGitHubUrl(input: string): GitHubRepositoryRef {
  const parsed = new URL(inputSchema.parse(input));
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || parsed.username || parsed.password || parsed.port) {
    throw new AppError("INVALID_GITHUB_URL", "Only public https://github.com/owner/repository URLs are accepted.", 400);
  }
  const parts = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length !== 2) throw new AppError("INVALID_GITHUB_URL", "The URL must identify one GitHub repository.", 400);
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/, "");
  if (!owner || !repo || !segment.test(owner) || !segment.test(repo)) throw new AppError("INVALID_GITHUB_URL", "Invalid GitHub owner or repository name.", 400);
  return { url: `https://github.com/${owner}/${repo}`, owner, repo };
}
