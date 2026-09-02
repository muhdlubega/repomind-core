PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  github_url TEXT NOT NULL,
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  default_branch TEXT,
  commit_sha TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','fetching','parsing','embedding','building_graph','finalizing','ready','failed')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(github_owner, github_repo, owner_id)
);
CREATE INDEX repositories_owner_idx ON repositories(owner_id);

CREATE TABLE repository_jobs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  files_discovered INTEGER NOT NULL DEFAULT 0,
  files_processed INTEGER NOT NULL DEFAULT 0,
  symbols INTEGER NOT NULL DEFAULT 0,
  chunks INTEGER NOT NULL DEFAULT 0,
  embeddings INTEGER NOT NULL DEFAULT 0,
  dependencies INTEGER NOT NULL DEFAULT 0,
  percentage INTEGER NOT NULL DEFAULT 0 CHECK(percentage BETWEEN 0 AND 100),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX jobs_repository_idx ON repository_jobs(repository_id, created_at DESC);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repository_id, path)
);
CREATE INDEX files_repository_idx ON files(repository_id, path);

CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  symbol_type TEXT NOT NULL,
  signature TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  exported INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX symbols_lookup_idx ON symbols(repository_id, name COLLATE NOCASE);
CREATE INDEX symbols_file_idx ON symbols(file_id, start_line);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  symbol_id TEXT REFERENCES symbols(id) ON DELETE SET NULL,
  commit_sha TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  symbol TEXT,
  symbol_type TEXT,
  parent_symbol TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  imports_json TEXT NOT NULL DEFAULT '[]',
  exports_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX chunks_repository_idx ON chunks(repository_id, path, start_line);
CREATE INDEX chunks_hash_idx ON chunks(repository_id, content_hash);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  chunk_id UNINDEXED,
  repository_id UNINDEXED,
  path,
  symbol,
  content,
  tokenize='unicode61 tokenchars ''_.$'''
);

CREATE TABLE dependencies (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_symbol_id TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  target_symbol_id TEXT REFERENCES symbols(id) ON DELETE CASCADE,
  target_name TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK(relationship IN ('IMPORTS','CALLS','REFERENCES','EXTENDS','IMPLEMENTS','RENDERS','EXPORTS','DEFINED_IN','TESTS')),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  UNIQUE(repository_id, source_symbol_id, target_name, relationship)
);
CREATE INDEX dependencies_source_idx ON dependencies(repository_id, source_symbol_id);
CREATE INDEX dependencies_target_idx ON dependencies(repository_id, target_symbol_id);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK(mode IN ('ask','investigate')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE citations (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  symbol TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  claim TEXT
);

CREATE TABLE evaluation_cases (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  expected_files_json TEXT NOT NULL DEFAULT '[]',
  expected_symbols_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE evaluation_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  status TEXT NOT NULL,
  metrics_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE TABLE usage (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  date TEXT NOT NULL,
  query_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  UNIQUE(actor_key, date)
);
