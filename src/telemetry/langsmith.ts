import { Client } from "langsmith/client";
import type { RuntimeConfig } from "../shared/env";

function sampled(sampleRate: number): boolean {
  if (sampleRate <= 0) return false;
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return (random[0] ?? 0) / 0xffffffff < sampleRate;
}

export async function traceCompletedRun(config: RuntimeConfig, name: string, inputs: Record<string, string | number | boolean>, outputs: Record<string, string | number | boolean>): Promise<void> {
  if (!config.LANGSMITH_TRACING || !config.LANGSMITH_API_KEY || !sampled(config.LANGSMITH_SAMPLE_RATE)) return;
  const client = new Client({
    apiKey: config.LANGSMITH_API_KEY,
    ...(config.LANGSMITH_WORKSPACE_ID ? { workspaceId: config.LANGSMITH_WORKSPACE_ID } : {}),
    autoBatchTracing: false,
    timeout_ms: 5_000,
    hideInputs: false,
    hideOutputs: false
  });
  const now = Date.now();
  await client.createRun({ id: crypto.randomUUID(), name, run_type: "chain", project_name: config.LANGSMITH_PROJECT, start_time: now, end_time: now, inputs, outputs, extra: { metadata: { service: "codelensa-core", environment: config.ENVIRONMENT } } });
}
