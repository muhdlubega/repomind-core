import { z } from "zod";

export const createRepositorySchema = z.object({ githubUrl: z.string().url().max(500) }).strict();
export const searchSchema = z.object({ query: z.string().trim().min(1).max(2000), strategy: z.enum(["vector", "lexical", "hybrid", "hybrid_graph", "hybrid_graph_rerank"]).default("hybrid_graph_rerank"), limit: z.number().int().min(1).max(50).default(20) }).strict();
export const chatSchema = z.object({ query: z.string().trim().min(1).max(2000), mode: z.enum(["ask", "investigate"]).default("ask"), conversationId: z.string().uuid().optional() }).strict();
export const evaluationRunSchema = z.object({ repositoryId: z.string().uuid(), strategy: z.enum(["vector", "lexical", "hybrid", "hybrid_graph", "hybrid_graph_rerank"]).default("hybrid_graph_rerank") }).strict();
