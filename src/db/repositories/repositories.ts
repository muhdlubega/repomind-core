import type { Principal, RepositoryStatus } from "../../shared/types";
import { AppError } from "../../shared/errors";

export interface RepositoryRow { id: string; owner_id: string | null; github_url: string; github_owner: string; github_repo: string; default_branch: string | null; commit_sha: string | null; status: RepositoryStatus; is_demo: number; indexed_at: string | null; created_at: string; updated_at: string }

export async function ensureUser(db: D1Database, principal: Principal): Promise<string | null> {
  if (principal.anonymous) return null;
  await db.prepare("INSERT INTO users (id, firebase_uid) VALUES (?, ?) ON CONFLICT(firebase_uid) DO NOTHING").bind(principal.userId, principal.firebaseUid).run();
  return principal.userId;
}

export async function getAccessibleRepository(db: D1Database, repositoryId: string, principal: Principal): Promise<RepositoryRow> {
  const row = await db.prepare("SELECT * FROM repositories WHERE id = ? AND (is_demo = 1 OR owner_id IS NULL OR owner_id = ?)").bind(repositoryId, principal.userId).first<RepositoryRow>();
  if (!row) throw new AppError("REPOSITORY_NOT_FOUND", "Repository was not found or is not accessible.", 404);
  return row;
}

export async function setJobProgress(db: D1Database, jobId: string, status: RepositoryStatus, percentage: number, counters: Partial<Record<"files_discovered" | "files_processed" | "symbols" | "chunks" | "embeddings" | "dependencies", number>> = {}, error?: string): Promise<void> {
  const fields = ["status = ?", "percentage = ?", "updated_at = datetime('now')"];
  const values: Array<string | number | null> = [status, percentage];
  for (const [key, value] of Object.entries(counters)) { fields.push(`${key} = ?`); values.push(value); }
  if (error !== undefined) { fields.push("error = ?"); values.push(error.slice(0, 2000)); }
  values.push(jobId);
  await db.prepare(`UPDATE repository_jobs SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  await db.prepare("UPDATE repositories SET status = ?, updated_at = datetime('now') WHERE id = (SELECT repository_id FROM repository_jobs WHERE id = ?)").bind(status, jobId).run();
}
