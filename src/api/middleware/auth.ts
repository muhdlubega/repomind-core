import { createMiddleware } from "hono/factory";
import type { Principal } from "../../shared/types";
import { AppError } from "../../shared/errors";
import { optionalPrincipal } from "../../auth/firebase";

export type AppVariables = { principal: Principal };
export type AppBindings = { Bindings: Env; Variables: AppVariables };

export const optionalAuth = createMiddleware<AppBindings>(async (context, next) => {
  context.set("principal", await optionalPrincipal(context.req.raw, context.env));
  await next();
});

export const requireAuth = createMiddleware<AppBindings>(async (context, next) => {
  const principal = context.get("principal");
  if (principal.anonymous) throw new AppError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
  await next();
});
