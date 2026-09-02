import { z } from "zod";

const positiveInt = z.coerce.number().int().positive();
const boolString = z.enum(["true", "false"]).transform((value) => value === "true");

export const runtimeConfigSchema = z.object({
  ENVIRONMENT: z.string().default("development"),
  FRONTEND_URL: z.string().url(),
  FIREBASE_PROJECT_ID: z.string().default(""),
  AI_PROVIDER: z.enum(["cloudflare", "gemini", "mistral"]).default("cloudflare"),
  CLOUDFLARE_CHAT_MODEL: z.string().min(1),
  CLOUDFLARE_EMBEDDING_MODEL: z.string().min(1),
  ENABLE_EXTERNAL_AGENT: boolString.default("false"),
  ENABLE_QUERY_REWRITE: boolString.default("true"),
  QUERY_REWRITE_PROVIDER: z.enum(["cloudflare", "gemini", "mistral"]).default("cloudflare"),
  ENABLE_AGENT_FALLBACK: boolString.default("false"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_MODEL: z.string().optional(),
  AGENT_PROVIDER: z.enum(["cloudflare", "gemini", "mistral"]).default("cloudflare"),
  AGENT_MODEL: z.string().optional(),
  AGENT_MAX_ITERATIONS: positiveInt.max(12).default(6),
  LANGSMITH_TRACING: boolString.default("false"),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("repomind"),
  LANGSMITH_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  ANONYMOUS_DAILY_QUERIES: positiveInt.default(5),
  AUTHENTICATED_DAILY_QUERIES: positiveInt.default(20),
  MAX_REPOSITORIES_PER_USER: positiveInt.default(2),
  MAX_REPO_FILES: positiveInt.default(3000),
  MAX_REPO_BYTES: positiveInt.default(52_428_800),
  MAX_FILE_BYTES: positiveInt.default(524_288),
  MAX_INDEXABLE_CHUNKS: positiveInt.default(20_000),
  MAX_GRAPH_DEPTH: positiveInt.max(4).default(2),
  GITHUB_TOKEN: z.string().optional()
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function getConfig(env: Env): RuntimeConfig {
  return runtimeConfigSchema.parse(env);
}
