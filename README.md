# CodeLensa Core

A repository RAG backend for public GitHub repositories, deployed on Cloudflare Workers.

## How it works

1. Link a public GitHub URL. GitHub metadata is validated before an indexing job is queued.
2. The queue consumer processes ten files per message, scheduling continuation batches to stay below Worker request limits. It reads the default branch at a fixed commit. It stores source and documentation in R2 and overlapping, line-numbered passages in D1.
3. Questions search only that repository's D1 full-text index. Overview questions retrieve README and project configuration.
4. One Mistral call answers using the retrieved passages. Citations are checked against stored files and line ranges.

There are no demo responses or synthetic repositories. Failures are returned to the caller. Graphs, agent loops, embeddings, and evaluations are not part of the question-answering path. Existing auxiliary modules and Cloudflare bindings are retained for compatibility; no data migration is required.

## Setup

Requires Node.js 22+, the D1/R2/KV/Queue resources in wrangler.jsonc, and:
- GITHUB_TOKEN: token with public repository read access.
- MISTRAL_API_KEY: Mistral API key. Production uses mistral-small-latest.
- FIREBASE_PROJECT_ID: optional authentication configuration.

Local secrets belong in .dev.vars; production secrets must be installed with wrangler secret put. Never commit keys. LangSmith and Gemini are not required by this flow.

Run npm install, npx wrangler d1 migrations apply codelensa --local, then npm run dev.
Validate with npm run typecheck, npm run lint, npm test, and npm run test:integration.
Deploy with npx wrangler deploy.

## API

- POST /v1/repositories — { "githubUrl": "https://github.com/owner/repo" }
- GET /v1/repositories — saved public indexes, without fixtures
- GET /v1/repositories/:id/index-status — live counters and error
- POST /v1/repositories/:id/reindex — retry a failed index or update a ready index
- GET /v1/repositories/:id/files — paginated file list
- GET /v1/repositories/:id/files/:fileId — stored source
- POST /v1/repositories/:id/chat/stream — { "query": "What does this project do?" }
- POST /v1/repositories/:id/chat — non-streaming equivalent

Public repository indexes are shared and persisted across browser sessions. Private repositories are rejected. Questions have the configured daily quota. Reindexing replaces the previous passages, so questions are disabled while indexing. Failed jobs expose their error and can be retried explicitly.

Files exceeding MAX_FILE_BYTES, binaries, generated directories, lockfiles, and unsupported extensions are skipped. Repositories over the configured file/byte/passage limits fail explicitly. No external AI embedding calls are required.
