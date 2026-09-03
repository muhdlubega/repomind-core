import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Context } from "hono";
import type { AppBindings } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { createRepositorySchema, chatSchema, evaluationRunSchema, searchSchema } from "../schemas/requests";
import { success } from "../responses/json";
import { getConfig } from "../../shared/env";
import { AppError } from "../../shared/errors";
import { parsePublicGitHubUrl } from "../../security/github-url";
import { ensureUser, getAccessibleRepository } from "../../db/repositories/repositories";
import { consumeQueryQuota } from "../middleware/rate-limit";
import { searchRepository, retrievalCacheKey } from "../../rag/search";
import type { RetrievedCode, CodeLensaAnswer } from "../../shared/types";
import { ModelRegistry } from "../../ai/registry/models";
import { buildRagGraph } from "../../rag/langgraph/graph";
import { buildInvestigationGraph } from "../../agent/graph";
import { buildContext } from "../../rag/context/builder";
import { generationPrompt } from "../../ai/prompts/generation";
import { citationsFromAnswer, validateCitations } from "../../rag/citations/validator";
import { retrievalConfidence } from "../../rag/confidence/calculate";
import { classifyQuestion } from "../../rag/routing/classifier";
import { graphForSymbol } from "../../rag/retrievers/graph";
import { traceCompletedRun } from "../../telemetry/langsmith";
import { buildDemoAnswer, buildDemoEvaluationRun, demoEvaluationRuns, demoFiles, demoRepository, filterDemoSearch } from "../../demo/fixtures";

const idSchema = z.string().uuid();
const paginationSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().optional() });

async function removeRepositoryObjects(env: Env, repositoryId: string): Promise<void> {
  const prefix = `repositories/${repositoryId}/`;
  let cursor: string | undefined;
  do {
    const listed = await env.REPOSITORIES.list({ prefix, ...(cursor ? { cursor } : {}) });
    if (listed.objects.length) await env.REPOSITORIES.delete(listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

async function persistAnswer(env: Env, repositoryId: string, userId: string | null, mode: "ask" | "investigate", query: string, answer: CodeLensaAnswer, conversationId?: string): Promise<string> {
  const conversation = conversationId ?? crypto.randomUUID();
  if (!conversationId) await env.DB.prepare("INSERT INTO conversations (id, repository_id, user_id, mode) VALUES (?, ?, ?, ?)").bind(conversation, repositoryId, userId, mode).run();
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = answer.id;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)").bind(userMessageId, conversation, query),
    env.DB.prepare("INSERT INTO messages (id, conversation_id, role, content, provider, model) VALUES (?, ?, 'assistant', ?, ?, ?)").bind(assistantMessageId, conversation, answer.answer, answer.model.provider, answer.model.model)
  ]);
  for (const citation of answer.citations) await env.DB.prepare("INSERT INTO citations (id, message_id, file_id, chunk_id, path, symbol, start_line, end_line, claim) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(citation.id, assistantMessageId, citation.fileId, citation.chunkId, citation.path, citation.symbol ?? null, citation.startLine, citation.endLine, citation.claim ?? null).run();
  return conversation;
}

export const v1 = new Hono<AppBindings>();

v1.get("/models", (context) => context.json(success(new ModelRegistry(context.env, getConfig(context.env)).list())));

v1.get("/usage", async (context) => {
  const principal = context.get("principal");
  const actor = principal.anonymous ? null : `user:${principal.userId}`;
  const rows = actor ? await context.env.DB.prepare("SELECT date, query_count, input_tokens, output_tokens, provider FROM usage WHERE actor_key = ? ORDER BY date DESC LIMIT 31").bind(actor).all() : { results: [] };
  return context.json(success(rows.results));
});

v1.post("/repositories", requireAuth, async (context) => {
  const body = createRepositorySchema.parse(await context.req.json());
  const reference = parsePublicGitHubUrl(body.githubUrl);
  const principal = context.get("principal");
  const config = getConfig(context.env);
  const ownerId = await ensureUser(context.env.DB, principal);
  const count = await context.env.DB.prepare("SELECT COUNT(*) AS total FROM repositories WHERE owner_id = ?").bind(ownerId).first<{ total: number }>();
  if ((count?.total ?? 0) >= config.MAX_REPOSITORIES_PER_USER) throw new AppError("REPOSITORY_LIMIT_REACHED", "Repository limit reached for this account.", 409);
  const existing = await context.env.DB.prepare("SELECT id, status FROM repositories WHERE owner_id = ? AND lower(github_owner) = lower(?) AND lower(github_repo) = lower(?)").bind(ownerId, reference.owner, reference.repo).first<{ id: string; status: string }>();
  if (existing) return context.json(success(existing), 200);
  const repositoryId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare("INSERT INTO repositories (id, owner_id, github_url, github_owner, github_repo, status) VALUES (?, ?, ?, ?, ?, 'queued')").bind(repositoryId, ownerId, reference.url, reference.owner, reference.repo),
    context.env.DB.prepare("INSERT INTO repository_jobs (id, repository_id, status) VALUES (?, ?, 'queued')").bind(jobId, repositoryId)
  ]);
  await context.env.INDEX_QUEUE.send({ kind: "index", repositoryId, jobId, githubOwner: reference.owner, githubRepo: reference.repo });
  return context.json(success({ repositoryId, jobId, status: "queued" }), 202);
});

v1.get("/repositories", async (context) => {
  const principal = context.get("principal");
  const rows = await context.env.DB.prepare("SELECT id, github_url, github_owner, github_repo, default_branch, commit_sha, status, is_demo, indexed_at, created_at, updated_at FROM repositories WHERE is_demo = 1 OR owner_id = ? ORDER BY created_at DESC LIMIT 100").bind(principal.userId).all();
  const repositories = rows.results.some((row) => (row as { id?: unknown }).id === demoRepository.id) ? rows.results : [demoRepository, ...rows.results];
  return context.json(success(repositories));
});

v1.get("/repositories/demo", (context) => context.json(success(demoRepository)));

v1.get("/repositories/demo/index-status", (context) =>
  context.json(
    success({
      repository_id: demoRepository.id,
      status: "completed",
      stage: "ready",
      progress: 1,
      files_processed: demoFiles.length,
      total_files: demoFiles.length,
      chunks_created: filterDemoSearch("").length,
      symbols_created: 3,
      message: "Demo repository is ready."
    })
  )
);

v1.get("/repositories/demo/files", (context) => {
  const pagination = paginationSchema.parse(context.req.query());
  const items = demoFiles.filter((file) => !pagination.cursor || file.path > pagination.cursor).slice(0, pagination.limit);
  return context.json(success({ items, nextCursor: items.length === pagination.limit ? items.at(-1)?.path ?? "" : null }));
});

v1.get("/repositories/demo/files/:fileId", (context) => {
  const file = demoFiles.find((item) => item.id === context.req.param("fileId"));
  if (!file) throw new AppError("FILE_NOT_FOUND", "File was not found.", 404);
  return context.json(success(file));
});

v1.get("/repositories/demo/search", (context) => {
  const request = searchSchema.parse({
    query: context.req.query("q") ?? context.req.query("query") ?? "hybrid search",
    strategy: context.req.query("strategy") ?? "hybrid_graph_rerank",
    limit: Number(context.req.query("limit") ?? 20)
  });
  return context.json(success({ results: filterDemoSearch(request.query, request.limit), cached: false }));
});

v1.post("/repositories/demo/search", async (context) => {
  const request = searchSchema.parse(await context.req.json());
  return context.json(success({ results: filterDemoSearch(request.query, request.limit), cached: false }));
});

v1.post("/repositories/demo/chat", async (context) => {
  const request = chatSchema.parse(await context.req.json());
  return context.json(success({ ...buildDemoAnswer(request.query), conversationId: "demo" }));
});

async function streamDemoChat(context: Context<AppBindings>) {
  const request =
    context.req.method === "GET"
      ? chatSchema.parse({ query: context.req.query("q") ?? context.req.query("query") ?? "How does hybrid search rank code?", mode: context.req.query("mode") ?? "ask" })
      : chatSchema.parse(await context.req.json());
  const answer = buildDemoAnswer(request.query);
  return streamSSE(context, async (stream) => {
    await stream.writeSSE({ event: "retrieval_started", data: JSON.stringify({ mode: request.mode }) });
    await stream.writeSSE({ event: "retrieval_completed", data: JSON.stringify({ chunks: answer.retrieval.chunksRetrieved, files: answer.retrieval.filesUsed }) });
    await stream.writeSSE({ event: "generation_started", data: JSON.stringify(answer.model) });
    for (let offset = 0; offset < answer.answer.length; offset += 80) await stream.writeSSE({ event: "token", data: JSON.stringify({ text: answer.answer.slice(offset, offset + 80) }) });
    for (const citation of answer.citations) await stream.writeSSE({ event: "citation", data: JSON.stringify(citation) });
    await stream.writeSSE({ event: "completed", data: JSON.stringify({ citations: answer.citations, retrievalConfidence: answer.retrieval.confidence, citationValidity: 1 }) });
  });
}

v1.get("/repositories/demo/chat/stream", streamDemoChat);
v1.post("/repositories/demo/chat/stream", streamDemoChat);

v1.get("/evaluations", (context) => context.json(success(demoEvaluationRuns)));

v1.get("/evaluations/run", (context) => context.json(success(buildDemoEvaluationRun())));

v1.post("/evaluations/run", async (context) => {
  let body: unknown = {};
  try {
    body = await context.req.json();
  } catch {
    body = {};
  }
  const maybeRepositoryId = z.object({ repositoryId: z.string().optional() }).passthrough().parse(body).repositoryId;
  if (!maybeRepositoryId || maybeRepositoryId === demoRepository.id) return context.json(success(buildDemoEvaluationRun()), 202);
  const principal = context.get("principal");
  if (principal.anonymous) throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
  const request = evaluationRunSchema.parse(body);
  await getAccessibleRepository(context.env.DB, request.repositoryId, principal);
  const runId = crypto.randomUUID();
  await context.env.DB.prepare("INSERT INTO evaluation_runs (id, repository_id, strategy, status) VALUES (?, ?, ?, 'running')").bind(runId, request.repositoryId, request.strategy).run();
  await context.env.INDEX_QUEUE.send({ kind: "evaluation", repositoryId: request.repositoryId, runId, strategy: request.strategy });
  return context.json(success({ runId, status: "running" }), 202);
});

v1.get("/repositories/:id", async (context) => context.json(success(await getAccessibleRepository(context.env.DB, idSchema.parse(context.req.param("id")), context.get("principal")))));

v1.delete("/repositories/:id", requireAuth, async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  const repository = await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  if (repository.is_demo) throw new AppError("DEMO_REPOSITORY_IMMUTABLE", "Demo repositories cannot be deleted.", 403);
  const chunks = await context.env.DB.prepare("SELECT id FROM chunks WHERE repository_id = ?").bind(id).all<{ id: string }>();
  for (let offset = 0; offset < chunks.results.length; offset += 1000) await context.env.CODE_INDEX.deleteByIds(chunks.results.slice(offset, offset + 1000).map((row) => `repo:${id}:chunk:${row.id}`));
  await removeRepositoryObjects(context.env, id);
  await context.env.DB.prepare("DELETE FROM chunks_fts WHERE repository_id = ?").bind(id).run();
  await context.env.DB.prepare("DELETE FROM repositories WHERE id = ? AND owner_id = ?").bind(id, context.get("principal").userId).run();
  return context.body(null, 204);
});

v1.get("/repositories/:id/index-status", async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  const job = await context.env.DB.prepare("SELECT * FROM repository_jobs WHERE repository_id = ? ORDER BY created_at DESC LIMIT 1").bind(id).first();
  return context.json(success(job));
});

v1.post("/repositories/:id/reindex", requireAuth, async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  const repository = await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  const jobId = crypto.randomUUID();
  await context.env.DB.prepare("INSERT INTO repository_jobs (id, repository_id, status) VALUES (?, ?, 'queued')").bind(jobId, id).run();
  await context.env.DB.prepare("UPDATE repositories SET status = 'queued', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  await context.env.INDEX_QUEUE.send({ kind: "index", repositoryId: id, jobId, githubOwner: repository.github_owner, githubRepo: repository.github_repo });
  return context.json(success({ repositoryId: id, jobId, status: "queued" }), 202);
});

v1.post("/repositories/:id/search", async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  const repository = await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  if (repository.status !== "ready" || !repository.commit_sha) throw new AppError("REPOSITORY_NOT_READY", "Repository indexing is not complete.", 409);
  const request = searchSchema.parse(await context.req.json());
  const config = getConfig(context.env);
  await consumeQueryQuota(context.env.DB, context.get("principal"), context.req.header("cf-connecting-ip") ?? "unknown", config);
  const cacheKey = await retrievalCacheKey(id, repository.commit_sha, request.query, request.strategy, config.CLOUDFLARE_EMBEDDING_MODEL);
  const cached = await context.env.CACHE.get<RetrievedCode[]>(cacheKey, "json");
  if (cached) return context.json(success({ results: cached.slice(0, request.limit), cached: true }));
  const results = await searchRepository(context.env, config, id, request.query, request.strategy, request.limit);
  await context.env.CACHE.put(cacheKey, JSON.stringify(results), { expirationTtl: 300 });
  return context.json(success({ results, cached: false }));
});

v1.post("/repositories/:id/chat", async (context) => {
  const started = Date.now();
  const id = idSchema.parse(context.req.param("id"));
  const repository = await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  if (repository.status !== "ready") throw new AppError("REPOSITORY_NOT_READY", "Repository indexing is not complete.", 409);
  const request = chatSchema.parse(await context.req.json());
  const config = getConfig(context.env);
  await consumeQueryQuota(context.env.DB, context.get("principal"), context.req.header("cf-connecting-ip") ?? "unknown", config);
  const registry = new ModelRegistry(context.env, config);
  const provider = registry.provider(request.mode === "investigate" ? "agent" : "generation");
  const retrievalStarted = Date.now();
  if (request.mode === "ask") {
    const state = await buildRagGraph({ env: context.env, config, provider }).invoke({ repositoryId: id, query: request.query, agentMode: false });
    const completed = Date.now();
    const answer: CodeLensaAnswer = { id: crypto.randomUUID(), answer: state.answer, citations: state.citations, retrieval: { queryType: state.queryType, chunksRetrieved: state.fusedResults.length, filesUsed: new Set(state.context.map((item) => item.path)).size, confidence: state.retrievalConfidence }, model: { provider: provider.id, model: provider.model }, timing: { retrievalMs: Math.max(0, completed - retrievalStarted), generationMs: 0, totalMs: completed - started } };
    context.executionCtx.waitUntil(traceCompletedRun(config, "codelensa.ask", { repositoryId: id, query: request.query }, { citations: answer.citations.length, confidence: answer.retrieval.confidence, provider: answer.model.provider }));
    const conversationId = await persistAnswer(context.env, id, context.get("principal").userId, request.mode, request.query, answer, request.conversationId);
    return context.json(success({ ...answer, conversationId }));
  }
  const state = await buildInvestigationGraph(context.env, config, provider).invoke({ repositoryId: id, query: request.query });
  const completed = Date.now();
  const answer: CodeLensaAnswer = { id: crypto.randomUUID(), answer: state.answer, citations: state.citations, retrieval: { queryType: classifyQuestion(request.query), chunksRetrieved: state.evidence.length, filesUsed: new Set(state.evidence.map((item) => item.path)).size, confidence: retrievalConfidence(state.evidence, buildContext(state.evidence), state.citations) }, model: { provider: provider.id, model: provider.model }, timing: { retrievalMs: completed - retrievalStarted, generationMs: 0, totalMs: completed - started } };
  context.executionCtx.waitUntil(traceCompletedRun(config, "codelensa.investigate", { repositoryId: id, query: request.query }, { citations: answer.citations.length, confidence: answer.retrieval.confidence, provider: answer.model.provider, iterations: state.iterationCount }));
  const conversationId = await persistAnswer(context.env, id, context.get("principal").userId, request.mode, request.query, answer, request.conversationId);
  return context.json(success({ ...answer, conversationId, investigation: { iterations: state.iterationCount, toolCalls: state.toolCalls } }));
});

v1.post("/repositories/:id/chat/stream", async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  const repository = await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  if (repository.status !== "ready") throw new AppError("REPOSITORY_NOT_READY", "Repository indexing is not complete.", 409);
  const request = chatSchema.parse(await context.req.json());
  const config = getConfig(context.env);
  await consumeQueryQuota(context.env.DB, context.get("principal"), context.req.header("cf-connecting-ip") ?? "unknown", config);
  const provider = new ModelRegistry(context.env, config).provider(request.mode === "investigate" ? "agent" : "generation");
  return streamSSE(context, async (stream) => {
    await stream.writeSSE({ event: "retrieval_started", data: JSON.stringify({ mode: request.mode }) });
    try {
      if (request.mode === "investigate") {
        await stream.writeSSE({ event: "progress", data: JSON.stringify({ message: "Searching repository evidence" }) });
        const investigation = await buildInvestigationGraph(context.env, config, provider).invoke({ repositoryId: id, query: request.query });
        const progressLabels: Readonly<Record<string, string>> = {
          search_code: "Searching code",
          search_symbols: "Searching symbols",
          semantic_search: "Searching semantically",
          find_references: "Checking references",
          find_callers: "Checking callers",
          find_callees: "Checking callees",
          find_importers: "Checking importers",
          find_imports: "Checking imports",
          get_related_tests: "Inspecting related tests",
          expand_dependency_graph: "Expanding dependencies",
          search_repository_structure: "Inspecting repository structure"
        };
        for (const call of investigation.toolCalls) await stream.writeSSE({ event: "progress", data: JSON.stringify({ message: progressLabels[call.tool] ?? "Inspecting evidence" }) });
        await stream.writeSSE({ event: "generation_started", data: JSON.stringify({ provider: provider.id, model: provider.model }) });
        for (let offset = 0; offset < investigation.answer.length; offset += 80) await stream.writeSSE({ event: "token", data: JSON.stringify({ text: investigation.answer.slice(offset, offset + 80) }) });
        for (const citation of investigation.citations) await stream.writeSSE({ event: "citation", data: JSON.stringify(citation) });
        const evidence = buildContext(investigation.evidence);
        await stream.writeSSE({ event: "completed", data: JSON.stringify({ citations: investigation.citations, iterations: investigation.iterationCount, retrievalConfidence: retrievalConfidence(investigation.evidence, evidence, investigation.citations), citationValidity: 1 }) });
        return;
      }
      const results = await searchRepository(context.env, config, id, request.query, "hybrid_graph_rerank", 24);
      const evidence = buildContext(results);
      await stream.writeSSE({ event: "retrieval_completed", data: JSON.stringify({ chunks: results.length, files: new Set(evidence.map((item) => item.path)).size }) });
      await stream.writeSSE({ event: "generation_started", data: JSON.stringify({ provider: provider.id, model: provider.model }) });
      let answer = "";
      for await (const chunk of provider.stream({ messages: [{ role: "user", content: generationPrompt(request.query, evidence) }], maxTokens: 1600, temperature: 0.1 })) {
        answer += chunk.content;
        await stream.writeSSE({ event: "token", data: JSON.stringify({ text: chunk.content }) });
      }
      const proposed = citationsFromAnswer(answer, evidence);
      const validated = await validateCitations(context.env.DB, id, proposed, evidence);
      for (const citation of validated.valid) await stream.writeSSE({ event: "citation", data: JSON.stringify(citation) });
      await stream.writeSSE({ event: "completed", data: JSON.stringify({ citations: validated.valid, retrievalConfidence: retrievalConfidence(results, evidence, validated.valid), citationValidity: validated.validity }) });
    } catch (error) {
      const message = error instanceof Error && error.message === "AI_DAILY_CAPACITY_REACHED" ? "CodeLensa's free AI capacity has been reached. Try again later or use a configured external provider." : "The streamed request failed.";
      await stream.writeSSE({ event: "error", data: JSON.stringify({ code: error instanceof Error && error.message === "AI_DAILY_CAPACITY_REACHED" ? "AI_DAILY_CAPACITY_REACHED" : "STREAM_FAILED", message }) });
    }
  });
});

v1.get("/repositories/:id/files", async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  const pagination = paginationSchema.parse(context.req.query());
  const rows = await context.env.DB.prepare("SELECT id, path, language, content_hash, size_bytes, line_count FROM files WHERE repository_id = ? AND (? IS NULL OR path > ?) ORDER BY path LIMIT ?").bind(id, pagination.cursor ?? null, pagination.cursor ?? null, pagination.limit).all<{ id: string; path: string; language: string; content_hash: string; size_bytes: number; line_count: number }>();
  return context.json(success({ items: rows.results, nextCursor: rows.results.length === pagination.limit ? rows.results.at(-1)?.path ?? "" : null }));
});

v1.get("/repositories/:id/files/:fileId", async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  const file = await context.env.DB.prepare("SELECT id, path, language, content_hash, size_bytes, line_count, r2_key FROM files WHERE id = ? AND repository_id = ?").bind(idSchema.parse(context.req.param("fileId")), id).first<{ id: string; path: string; language: string; content_hash: string; size_bytes: number; line_count: number; r2_key: string }>();
  if (!file) throw new AppError("FILE_NOT_FOUND", "File was not found.", 404);
  const object = await context.env.REPOSITORIES.get(file.r2_key);
  if (!object) throw new AppError("FILE_CONTENT_MISSING", "Stored file content is missing.", 404);
  return context.json(success({ ...file, content: await object.text() }));
});

v1.get("/repositories/:id/symbols", async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  const query = context.req.query("q")?.slice(0, 200) ?? "";
  const rows = await context.env.DB.prepare("SELECT s.*, f.path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.repository_id = ? AND (? = '' OR s.name LIKE ? ESCAPE '\\') ORDER BY s.name LIMIT 100").bind(id, query, `%${query.replace(/[\\%_]/g, "\\$&")}%`).all();
  return context.json(success(rows.results));
});

v1.get("/repositories/:id/symbols/:symbolId", async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  const symbol = await context.env.DB.prepare("SELECT s.*, f.path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.id = ? AND s.repository_id = ?").bind(idSchema.parse(context.req.param("symbolId")), id).first();
  if (!symbol) throw new AppError("SYMBOL_NOT_FOUND", "Symbol was not found.", 404);
  return context.json(success(symbol));
});

v1.get("/repositories/:id/graph", async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  const rows = await context.env.DB.prepare("SELECT relationship, COUNT(*) AS count FROM dependencies WHERE repository_id = ? GROUP BY relationship").bind(id).all();
  return context.json(success({ relationships: rows.results }));
});

v1.get("/repositories/:id/graph/symbol/:symbolId", async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  const depth = z.coerce.number().int().min(1).max(getConfig(context.env).MAX_GRAPH_DEPTH).default(1).parse(context.req.query("depth"));
  return context.json(success(await graphForSymbol(context.env.DB, id, idSchema.parse(context.req.param("symbolId")), depth)));
});

v1.get("/repositories/:id/evaluations", async (context) => {
  const id = idSchema.parse(context.req.param("id"));
  await getAccessibleRepository(context.env.DB, id, context.get("principal"));
  const [cases, runs] = await Promise.all([context.env.DB.prepare("SELECT * FROM evaluation_cases WHERE repository_id = ? ORDER BY created_at DESC").bind(id).all(), context.env.DB.prepare("SELECT * FROM evaluation_runs WHERE repository_id = ? ORDER BY created_at DESC LIMIT 50").bind(id).all()]);
  return context.json(success({ cases: cases.results, runs: runs.results }));
});

v1.get("/evaluations/:runId", async (context) => {
  const run = await context.env.DB.prepare("SELECT * FROM evaluation_runs WHERE id = ?").bind(idSchema.parse(context.req.param("runId"))).first<{ repository_id: string } & Record<string, unknown>>();
  if (!run) throw new AppError("EVALUATION_NOT_FOUND", "Evaluation run was not found.", 404);
  await getAccessibleRepository(context.env.DB, run.repository_id, context.get("principal"));
  return context.json(success(run));
});
