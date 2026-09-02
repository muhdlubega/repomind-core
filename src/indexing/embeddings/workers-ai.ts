import { z } from "zod";

const embeddingResponse = z.union([
  z.object({ data: z.array(z.array(z.number())) }),
  z.object({ shape: z.array(z.number()), data: z.array(z.number()) })
]);

export async function embedTexts(ai: Ai, model: string, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const raw: unknown = await ai.run(model, { text: texts });
  const parsed = embeddingResponse.parse(raw);
  if (!("shape" in parsed)) return parsed.data;
  const dimensions = parsed.shape.at(-1) ?? 0;
  if (!dimensions) throw new Error("Invalid embedding dimensions");
  const flat = parsed.data;
  return Array.from({ length: texts.length }, (_, index) => flat.slice(index * dimensions, (index + 1) * dimensions));
}
