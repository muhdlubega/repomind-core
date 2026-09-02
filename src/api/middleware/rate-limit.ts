import type { Principal } from "../../shared/types";
import type { RuntimeConfig } from "../../shared/env";
import { AppError } from "../../shared/errors";

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function consumeQueryQuota(db: D1Database, principal: Principal, ip: string, config: RuntimeConfig): Promise<{ used: number; limit: number }> {
  const actorKey = principal.anonymous ? `anon:${await hash(ip || "unknown")}` : `user:${principal.userId}`;
  const date = new Date().toISOString().slice(0, 10);
  const limit = principal.anonymous ? config.ANONYMOUS_DAILY_QUERIES : config.AUTHENTICATED_DAILY_QUERIES;
  await db.prepare("INSERT INTO usage (id, actor_key, date, query_count) VALUES (?, ?, ?, 1) ON CONFLICT(actor_key, date) DO UPDATE SET query_count = query_count + 1").bind(crypto.randomUUID(), actorKey, date).run();
  const row = await db.prepare("SELECT query_count FROM usage WHERE actor_key = ? AND date = ?").bind(actorKey, date).first<{ query_count: number }>();
  const used = row?.query_count ?? limit + 1;
  if (used > limit) throw new AppError("DAILY_QUERY_LIMIT_REACHED", "Daily query limit reached.", 429, { limit });
  return { used, limit };
}
