import { z } from "zod";
import type { Principal } from "../shared/types";
import { AppError } from "../shared/errors";
import { getConfig } from "../shared/env";

const headerSchema = z.object({ alg: z.literal("RS256"), kid: z.string().min(1) });
const claimsSchema = z.object({ aud: z.string(), iss: z.string(), sub: z.string().min(1), exp: z.number(), iat: z.number(), user_id: z.string().optional() });
const jwkSchema = z.object({ keys: z.array(z.object({ kid: z.string(), kty: z.literal("RSA"), alg: z.literal("RS256"), use: z.literal("sig"), n: z.string(), e: z.string() })) });

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function parseJsonPart(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getKeys(cache: KVNamespace): Promise<z.infer<typeof jwkSchema>> {
  const cached = await cache.get("firebase:securetoken-jwks", "json");
  const parsedCache = jwkSchema.safeParse(cached);
  if (parsedCache.success) return parsedCache.data;
  const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!response.ok) throw new AppError("AUTH_KEYS_UNAVAILABLE", "Authentication keys are temporarily unavailable.", 503);
  const keys = jwkSchema.parse(await response.json());
  const cacheControl = response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1];
  await cache.put("firebase:securetoken-jwks", JSON.stringify(keys), { expirationTtl: Math.max(60, Number(cacheControl ?? 3600)) });
  return keys;
}

export async function verifyFirebaseIdToken(token: string, env: Env): Promise<Principal> {
  const projectId = getConfig(env).FIREBASE_PROJECT_ID;
  if (!projectId) throw new AppError("AUTH_NOT_CONFIGURED", "Firebase authentication is not configured.", 503);
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new AppError("INVALID_TOKEN", "Invalid authentication token.", 401);
  const header = headerSchema.parse(parseJsonPart(parts[0]));
  const claims = claimsSchema.parse(parseJsonPart(parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` || claims.exp <= now || claims.iat > now + 60) throw new AppError("INVALID_TOKEN", "Authentication token claims are invalid.", 401);
  const jwk = (await getKeys(env.CACHE)).keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new AppError("INVALID_TOKEN", "Authentication token key is unknown.", 401);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!verified) throw new AppError("INVALID_TOKEN", "Authentication token signature is invalid.", 401);
  return { userId: claims.sub, firebaseUid: claims.user_id ?? claims.sub, anonymous: false };
}

export async function optionalPrincipal(request: Request, env: Env): Promise<Principal> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return { userId: null, firebaseUid: null, anonymous: true };
  if (!authorization.startsWith("Bearer ")) throw new AppError("INVALID_AUTHORIZATION", "Use a Bearer token.", 401);
  return verifyFirebaseIdToken(authorization.slice(7), env);
}
