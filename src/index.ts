import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppBindings } from "./api/middleware/auth";
import { optionalAuth } from "./api/middleware/auth";
import { v1 } from "./api/routes/v1";
import { failure, success } from "./api/responses/json";
import { getConfig } from "./shared/env";
import { normalizeError } from "./shared/errors";
import type { QueueJobMessage } from "./shared/types";
import { indexRepository } from "./indexing/pipeline/index-repository";
import { setJobProgress } from "./db/repositories/repositories";
import { runEvaluation } from "./evaluation/run";

const app = new Hono<AppBindings>();
app.use("*", async (context, next) => {
  const config = getConfig(context.env);
  const origin = context.req.header("origin");
  if (origin === config.FRONTEND_URL) {
    context.header("Access-Control-Allow-Origin", origin);
    context.header("Vary", "Origin");
    context.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    context.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    context.header("Access-Control-Max-Age", "86400");
  }
  if (context.req.method === "OPTIONS") return context.body(null, 204);
  await next();
});
app.use("*", bodyLimit({ maxSize: 64 * 1024, onError: (context) => context.json(failure("REQUEST_TOO_LARGE", "Request body is too large."), 413) }));
app.use("/v1/*", optionalAuth);
app.get("/health", (context) => context.json(success({ status: "ok", environment: getConfig(context.env).ENVIRONMENT, timestamp: new Date().toISOString() })));
app.route("/v1", v1);
app.notFound((context) => context.json(failure("NOT_FOUND", "Route not found."), 404));
app.onError((error, context) => {
  const normalized = normalizeError(error);
  console.error(JSON.stringify({ message: "request failed", code: normalized.code, error: error instanceof Error ? error.message : String(error), path: context.req.path }));
  if (error instanceof Error && error.message === "AI_DAILY_CAPACITY_REACHED") return context.json(failure("AI_DAILY_CAPACITY_REACHED", "RepoMind's free AI capacity has been reached. Try again later or use a configured external provider."), 503);
  return context.json(failure(normalized.code, normalized.message, normalized.details), normalized.status as 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 503);
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueJobMessage>, env: Env): Promise<void> {
    const config = getConfig(env);
    for (const message of batch.messages) {
      try {
        if (message.body.kind === "index") await indexRepository(env, config, message.body);
        else await runEvaluation(env, config, message.body.repositoryId, message.body.strategy, message.body.runId);
        message.ack();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({ message: "queue job failed", kind: message.body.kind, repositoryId: message.body.repositoryId, error: detail }));
        if (message.body.kind === "index") await setJobProgress(env.DB, message.body.jobId, "failed", 100, {}, detail);
        else await env.DB.prepare("UPDATE evaluation_runs SET status = 'failed', metrics_json = ?, completed_at = datetime('now') WHERE id = ?").bind(JSON.stringify({ error: detail.slice(0, 1000) }), message.body.runId).run();
        message.retry();
      }
    }
  }
} satisfies ExportedHandler<Env, QueueJobMessage>;
