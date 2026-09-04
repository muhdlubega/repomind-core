import type { IndexJobMessage } from "../../shared/types";
import type { RuntimeConfig } from "../../shared/env";
import { AppError } from "../../shared/errors";
import { isProbablyBinary, languageForPath } from "../../security/content";
import type { GitHubSnapshot } from "../github/client";
import { GitHubClient } from "../github/client";
import { chunkParsedFile, sha256 } from "../chunking/ast-chunker";
import { setJobProgress } from "../../db/repositories/repositories";


async function removePreviousIndex(env: Env, repositoryId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM chunks_fts WHERE repository_id = ?").bind(repositoryId),
    env.DB.prepare("DELETE FROM files WHERE repository_id = ?").bind(repositoryId)
  ]);
}

export async function indexRepository(env: Env, config: RuntimeConfig, message: IndexJobMessage): Promise<void> {
  const latest = await env.DB.prepare("SELECT id, status, files_processed, chunks FROM repository_jobs WHERE repository_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(message.repositoryId).first<{ id: string; status: string; files_processed: number; chunks: number }>();
  if (!latest || latest.id !== message.jobId || latest.status === "ready") return;
  const github = new GitHubClient(config.GITHUB_TOKEN);
  const manifestKey = `repositories/${message.repositoryId}/jobs/${message.jobId}.json`;
  let snapshot: GitHubSnapshot;
  if (message.cursor === undefined) {
    if (latest.status !== "queued") return;
    await setJobProgress(env.DB, message.jobId, "fetching", 5);
    snapshot = await github.snapshot(message.githubOwner, message.githubRepo);
    snapshot.files = snapshot.files.filter(file => languageForPath(file.path) && file.size <= config.MAX_FILE_BYTES);
    const totalBytes = snapshot.files.reduce((sum, file) => sum + file.size, 0);
    if (snapshot.files.length > config.MAX_REPO_FILES || totalBytes > config.MAX_REPO_BYTES) throw new AppError("REPOSITORY_LIMIT_EXCEEDED", "Repository exceeds configured indexing limits.", 413);
    await env.REPOSITORIES.put(manifestKey, JSON.stringify(snapshot));
    await removePreviousIndex(env, message.repositoryId);
    await env.DB.prepare("UPDATE repositories SET default_branch = ?, commit_sha = ?, status = 'parsing', updated_at = datetime('now') WHERE id = ?").bind(snapshot.defaultBranch, snapshot.commitSha, message.repositoryId).run();
    await setJobProgress(env.DB, message.jobId, "parsing", 10, { files_discovered: snapshot.files.length });
  } else {
    if (message.cursor !== latest.files_processed) return;
    const manifest = await env.REPOSITORIES.get(manifestKey);
    if (!manifest) throw new AppError("INDEX_MANIFEST_MISSING", "Index state is missing. Please reindex.", 500);
    snapshot = await manifest.json<GitHubSnapshot>();
  }
  const candidates = snapshot.files;
  const cursor = message.cursor ?? 0;
  let processed = cursor;
  let chunkCount = message.cursor === undefined ? 0 : latest.chunks;
  const batchEnd = Math.min(cursor + 10, candidates.length);
  for (const candidate of candidates.slice(cursor, batchEnd)) {
    if (chunkCount >= config.MAX_INDEXABLE_CHUNKS) throw new AppError("CHUNK_LIMIT", "Repository exceeds the passage limit. Link a smaller repository.", 413);
    const language = languageForPath(candidate.path);
    if (!language) continue;
    const bytes = await github.file(message.githubOwner, message.githubRepo, snapshot.commitSha, candidate.path, config.MAX_FILE_BYTES);
    if (isProbablyBinary(bytes)) { processed += 1; continue; }
    const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const contentHash = await sha256(content);
    const fileId = crypto.randomUUID();
    const r2Key = `repositories/${message.repositoryId}/${snapshot.commitSha}/files/${candidate.path}`;
    await env.REPOSITORIES.put(r2Key, bytes, { customMetadata: { contentHash, language } });
    const generated = await chunkParsedFile(message.repositoryId, snapshot.commitSha, candidate.path, language, content, { symbols: [], dependencies: [], imports: [], exports: [] });
    if (chunkCount + generated.length > config.MAX_INDEXABLE_CHUNKS) throw new AppError("CHUNK_LIMIT", "Repository exceeds the passage limit. Link a smaller repository.", 413);
    await env.DB.prepare("INSERT INTO files (id, repository_id, path, language, content_hash, size_bytes, line_count, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(fileId, message.repositoryId, candidate.path, language, contentHash, bytes.byteLength, content.split(/\r?\n/).length, r2Key).run();
    for (const chunk of generated) {
      const chunkId = crypto.randomUUID();
      const symbolId = null;
      await env.DB.batch([
        env.DB.prepare("INSERT INTO chunks (id, repository_id, file_id, symbol_id, commit_sha, path, language, symbol, symbol_type, parent_symbol, start_line, end_line, imports_json, exports_json, content_hash, content, token_estimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(chunkId, message.repositoryId, fileId, symbolId, snapshot.commitSha, candidate.path, language, chunk.metadata.symbol ?? null, chunk.metadata.symbolType ?? null, chunk.metadata.parentSymbol ?? null, chunk.metadata.startLine, chunk.metadata.endLine, JSON.stringify(chunk.metadata.imports ?? []), JSON.stringify(chunk.metadata.exports ?? []), chunk.metadata.contentHash, chunk.content, chunk.tokenEstimate),
        env.DB.prepare("INSERT INTO chunks_fts (chunk_id, repository_id, path, symbol, content) VALUES (?, ?, ?, ?, ?)").bind(chunkId, message.repositoryId, candidate.path, chunk.metadata.symbol ?? "", chunk.content)
      ]);
    }
    processed += 1;
    chunkCount += generated.length;
    await setJobProgress(env.DB, message.jobId, "parsing", 10 + Math.floor((processed / Math.max(1, candidates.length)) * 80), { files_processed: processed, symbols: 0, chunks: chunkCount });
  }

  await setJobProgress(env.DB, message.jobId, "parsing", 10 + Math.floor((processed / Math.max(1, candidates.length)) * 80), { files_processed: processed, chunks: chunkCount });
  if (batchEnd < candidates.length) {
    await env.INDEX_QUEUE.send({ ...message, cursor: batchEnd });
    return;
  }
  if (!chunkCount) throw new AppError("NO_INDEXABLE_FILES", "No supported text or source files were found in this repository.", 400);
  await setJobProgress(env.DB, message.jobId, "finalizing", 97);
  await env.DB.prepare("UPDATE repositories SET status = 'ready', indexed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(message.repositoryId).run();
  await setJobProgress(env.DB, message.jobId, "ready", 100, { files_processed: processed, symbols: 0, chunks: chunkCount, embeddings: 0, dependencies: 0 });
}
