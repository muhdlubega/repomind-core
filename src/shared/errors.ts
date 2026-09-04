import OpenAI from "openai";
import { ZodError } from "zod";
export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly details?: unknown) {
    super(message);
    this.name = "AppError";
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof OpenAI.APIError && error.status === 429) return new AppError("MODEL_RATE_LIMITED", "Mistral API usage is currently rate-limited. Wait for the quota to reset or check your Mistral account limits.", 429);
  if (error instanceof OpenAI.APIError && error.status === 401) return new AppError("MODEL_AUTH_FAILED", "The Mistral API key was rejected. Update the backend API key.", 503);
  if (error instanceof ZodError) return new AppError("INVALID_REQUEST", "Check the repository URL or question and try again.", 400);
  if (error instanceof AppError) return error;
  return new AppError("INTERNAL_ERROR", "An unexpected error occurred.", 500);
}
