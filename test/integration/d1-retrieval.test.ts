import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { lexicalSearch } from "../../src/rag/retrievers/lexical";
import { getAccessibleRepository } from "../../src/db/repositories/repositories";
import { validateCitations } from "../../src/rag/citations/validator";
import type { Citation, Principal, RetrievedCode } from "../../src/shared/types";

const owner: Principal = { userId: "owner", firebaseUid: "owner", anonymous: false };
const stranger: Principal = { userId: "stranger", firebaseUid: "stranger", anonymous: false };

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id, firebase_uid) VALUES ('owner', 'owner'), ('stranger', 'stranger')"),
    env.DB.prepare("INSERT OR IGNORE INTO repositories (id, owner_id, github_url, github_owner, github_repo, commit_sha, status) VALUES ('11111111-1111-4111-8111-111111111111', 'owner', 'https://github.com/acme/repo', 'acme', 'repo', 'sha', 'ready')"),
    env.DB.prepare("INSERT OR IGNORE INTO files (id, repository_id, path, language, content_hash, size_bytes, line_count, r2_key) VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'src/auth.ts', 'typescript', 'hash', 50, 5, 'safe-key')"),
    env.DB.prepare("INSERT OR IGNORE INTO symbols (id, repository_id, file_id, name, qualified_name, symbol_type, start_line, end_line) VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'authenticate', 'src/auth.ts:authenticate', 'function', 1, 3)"),
    env.DB.prepare("INSERT OR IGNORE INTO chunks (id, repository_id, file_id, symbol_id, commit_sha, path, language, symbol, symbol_type, start_line, end_line, content_hash, content, token_estimate) VALUES ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'sha', 'src/auth.ts', 'typescript', 'authenticate', 'function', 1, 3, 'chunk-hash', 'export function authenticate(token) { return token; }', 15)"),
    env.DB.prepare("INSERT OR IGNORE INTO chunks_fts (chunk_id, repository_id, path, symbol, content) VALUES ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'src/auth.ts', 'authenticate', 'export function authenticate(token) { return token; }')")
  ]);
}

beforeEach(seed);

describe("D1 repository lifecycle and retrieval", () => {
  it("uses migrated FTS/symbol indexes for lexical retrieval", async () => {
    const results = await lexicalSearch(env.DB, "11111111-1111-4111-8111-111111111111", "authenticate", 10);
    expect(results[0]).toMatchObject({ path: "src/auth.ts", symbol: "authenticate", repositoryId: "11111111-1111-4111-8111-111111111111" });
  });

  it("enforces repository ownership isolation", async () => {
    await expect(getAccessibleRepository(env.DB, "11111111-1111-4111-8111-111111111111", owner)).resolves.toMatchObject({ github_repo: "repo" });
    await expect(getAccessibleRepository(env.DB, "11111111-1111-4111-8111-111111111111", stranger)).rejects.toMatchObject({ code: "REPOSITORY_NOT_FOUND" });
  });

  it("resolves only context-backed citations with valid line ranges", async () => {
    const context: RetrievedCode[] = [{ id: "44444444-4444-4444-8444-444444444444", fileId: "22222222-2222-4222-8222-222222222222", repositoryId: "11111111-1111-4111-8111-111111111111", commitSha: "sha", path: "src/auth.ts", language: "typescript", symbol: "authenticate", startLine: 1, endLine: 3, contentHash: "chunk-hash", content: "code", score: 1, source: "lexical", reasons: [] }];
    const valid: Citation = { id: "citation", fileId: context[0]?.fileId ?? "", path: "src/auth.ts", symbol: "authenticate", startLine: 1, endLine: 3, chunkId: context[0]?.id ?? "" };
    const invalid: Citation = { ...valid, id: "invalid", endLine: 99 };
    const result = await validateCitations(env.DB, context[0]?.repositoryId ?? "", [valid, invalid], context);
    expect(result.valid).toEqual([valid]);
    expect(result.invalid).toEqual([invalid]);
    expect(result.validity).toBe(0.5);
  });
});
