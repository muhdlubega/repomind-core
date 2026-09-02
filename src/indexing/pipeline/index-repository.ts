import type { IndexJobMessage, Relationship } from "../../shared/types";
import type { RuntimeConfig } from "../../shared/env";
import { AppError } from "../../shared/errors";
import { isProbablyBinary, languageForPath } from "../../security/content";
import { GitHubClient } from "../github/client";
import { TreeSitterCodeParser } from "../parsing/tree-sitter-parser";
import { chunkParsedFile, sha256 } from "../chunking/ast-chunker";
import { embedTexts } from "../embeddings/workers-ai";
import { setJobProgress } from "../../db/repositories/repositories";
import type { CodeParser } from "../parsing/types";

interface PersistedSymbol { id: string; name: string }

async function removePreviousIndex(env: Env, repositoryId: string): Promise<void> {
  const ids = await env.DB.prepare("SELECT id FROM chunks WHERE repository_id = ?").bind(repositoryId).all<{ id: string }>();
  for (let offset = 0; offset < ids.results.length; offset += 1000) {
    await env.CODE_INDEX.deleteByIds(ids.results.slice(offset, offset + 1000).map((row) => `repo:${repositoryId}:chunk:${row.id}`));
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM chunks_fts WHERE repository_id = ?").bind(repositoryId),
    env.DB.prepare("DELETE FROM files WHERE repository_id = ?").bind(repositoryId)
  ]);
}

export async function indexRepository(env: Env, config: RuntimeConfig, message: IndexJobMessage): Promise<void> {
  const github = new GitHubClient(config.GITHUB_TOKEN);
  await setJobProgress(env.DB, message.jobId, "fetching", 5);
  const snapshot = await github.snapshot(message.githubOwner, message.githubRepo);
  const candidates = snapshot.files.filter((file) => languageForPath(file.path) && file.size <= config.MAX_FILE_BYTES);
  const totalBytes = candidates.reduce((sum, file) => sum + file.size, 0);
  if (candidates.length > config.MAX_REPO_FILES || totalBytes > config.MAX_REPO_BYTES) throw new AppError("REPOSITORY_LIMIT_EXCEEDED", "Repository exceeds configured indexing limits.", 413);
  await removePreviousIndex(env, message.repositoryId);
  await env.DB.prepare("UPDATE repositories SET default_branch = ?, commit_sha = ?, status = 'parsing', updated_at = datetime('now') WHERE id = ?").bind(snapshot.defaultBranch, snapshot.commitSha, message.repositoryId).run();
  await setJobProgress(env.DB, message.jobId, "parsing", 10, { files_discovered: candidates.length });

  let processed = 0;
  let symbolCount = 0;
  let chunkCount = 0;
  let dependencyCount = 0;
  const unresolvedDependencies: Array<{ sourceSymbolId: string; targetName: string; relationship: Relationship; confidence: number }> = [];
  const symbolsByName = new Map<string, string>();
  const pendingEmbeddings: Array<{ id: string; text: string; repositoryId: string; path: string }> = [];
  const parsers = new Map<string, CodeParser>();

  for (const candidate of candidates) {
    if (chunkCount >= config.MAX_INDEXABLE_CHUNKS) break;
    const language = languageForPath(candidate.path);
    if (!language) continue;
    const bytes = await github.file(message.githubOwner, message.githubRepo, candidate.sha, config.MAX_FILE_BYTES);
    if (isProbablyBinary(bytes)) continue;
    const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const contentHash = await sha256(content);
    const fileId = crypto.randomUUID();
    const r2Key = `repositories/${message.repositoryId}/${snapshot.commitSha}/files/${candidate.path}`;
    await env.REPOSITORIES.put(r2Key, bytes, { customMetadata: { contentHash, language } });
    let parser = parsers.get(language);
    if (!parser) {
      parser = await TreeSitterCodeParser.create(env.REPOSITORIES, language);
      parsers.set(language, parser);
    }
    const parsed = await parser.parse(candidate.path, language, content);
    const generated = (await chunkParsedFile(message.repositoryId, snapshot.commitSha, candidate.path, language, content, parsed)).slice(0, config.MAX_INDEXABLE_CHUNKS - chunkCount);
    await env.DB.prepare("INSERT INTO files (id, repository_id, path, language, content_hash, size_bytes, line_count, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(fileId, message.repositoryId, candidate.path, language, contentHash, bytes.byteLength, content.split(/\r?\n/).length, r2Key).run();
    const persistedSymbols: PersistedSymbol[] = [];
    for (const symbol of parsed.symbols) {
      const symbolId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO symbols (id, repository_id, file_id, name, qualified_name, symbol_type, signature, start_line, end_line, exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(symbolId, message.repositoryId, fileId, symbol.name, symbol.qualifiedName, symbol.type, symbol.signature, symbol.startLine, symbol.endLine, symbol.exported ? 1 : 0).run();
      persistedSymbols.push({ id: symbolId, name: symbol.name });
      if (!symbolsByName.has(symbol.name)) symbolsByName.set(symbol.name, symbolId);
    }
    for (const dependency of parsed.dependencies) {
      const source = persistedSymbols.find((symbol) => symbol.name === dependency.sourceName);
      if (source) unresolvedDependencies.push({ sourceSymbolId: source.id, targetName: dependency.targetName, relationship: dependency.relationship, confidence: dependency.confidence });
    }
    for (const chunk of generated) {
      const chunkId = crypto.randomUUID();
      const symbolId = chunk.metadata.symbol ? persistedSymbols.find((symbol) => symbol.name === chunk.metadata.symbol)?.id ?? null : null;
      await env.DB.batch([
        env.DB.prepare("INSERT INTO chunks (id, repository_id, file_id, symbol_id, commit_sha, path, language, symbol, symbol_type, parent_symbol, start_line, end_line, imports_json, exports_json, content_hash, content, token_estimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(chunkId, message.repositoryId, fileId, symbolId, snapshot.commitSha, candidate.path, language, chunk.metadata.symbol ?? null, chunk.metadata.symbolType ?? null, chunk.metadata.parentSymbol ?? null, chunk.metadata.startLine, chunk.metadata.endLine, JSON.stringify(chunk.metadata.imports ?? []), JSON.stringify(chunk.metadata.exports ?? []), chunk.metadata.contentHash, chunk.content, chunk.tokenEstimate),
        env.DB.prepare("INSERT INTO chunks_fts (chunk_id, repository_id, path, symbol, content) VALUES (?, ?, ?, ?, ?)").bind(chunkId, message.repositoryId, candidate.path, chunk.metadata.symbol ?? "", chunk.content)
      ]);
      pendingEmbeddings.push({ id: chunkId, text: `${candidate.path}\n${chunk.metadata.symbol ?? "module"}\n${chunk.content}`, repositoryId: message.repositoryId, path: candidate.path });
    }
    processed += 1;
    symbolCount += persistedSymbols.length;
    chunkCount += generated.length;
    await setJobProgress(env.DB, message.jobId, "parsing", 10 + Math.floor((processed / Math.max(1, candidates.length)) * 45), { files_processed: processed, symbols: symbolCount, chunks: chunkCount });
  }

  await setJobProgress(env.DB, message.jobId, "embedding", 58, { files_processed: processed, symbols: symbolCount, chunks: chunkCount });
  let embedded = 0;
  for (let offset = 0; offset < pendingEmbeddings.length; offset += 32) {
    const batch = pendingEmbeddings.slice(offset, offset + 32);
    const vectors = await embedTexts(env.AI, config.CLOUDFLARE_EMBEDDING_MODEL, batch.map((item) => item.text));
    await env.CODE_INDEX.upsert(batch.map((item, index) => ({ id: `repo:${item.repositoryId}:chunk:${item.id}`, namespace: item.repositoryId, values: vectors[index] ?? [], metadata: { repositoryId: item.repositoryId, chunkId: item.id, path: item.path } })));
    embedded += batch.length;
    await setJobProgress(env.DB, message.jobId, "embedding", 58 + Math.floor((embedded / Math.max(1, pendingEmbeddings.length)) * 25), { embeddings: embedded });
  }

  await setJobProgress(env.DB, message.jobId, "building_graph", 86);
  for (const dependency of unresolvedDependencies.slice(0, config.MAX_INDEXABLE_CHUNKS * 10)) {
    const targetSymbolId = symbolsByName.get(dependency.targetName) ?? null;
    await env.DB.prepare("INSERT OR IGNORE INTO dependencies (id, repository_id, source_symbol_id, target_symbol_id, target_name, relationship, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), message.repositoryId, dependency.sourceSymbolId, targetSymbolId, dependency.targetName, dependency.relationship, dependency.confidence).run();
    dependencyCount += 1;
  }
  await setJobProgress(env.DB, message.jobId, "finalizing", 97, { dependencies: dependencyCount });
  await env.DB.prepare("UPDATE repositories SET status = 'ready', indexed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(message.repositoryId).run();
  await setJobProgress(env.DB, message.jobId, "ready", 100, { files_processed: processed, symbols: symbolCount, chunks: chunkCount, embeddings: embedded, dependencies: dependencyCount });
}
