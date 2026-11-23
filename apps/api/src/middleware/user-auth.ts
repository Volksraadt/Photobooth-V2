import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';
import { bearerToken, unauthorized } from './bearer';

/** `Authorization: Bearer <Supabase access token | dev token>`. Sets c.var.user. */
export const userAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c.req.header('authorization'));
  if (!token) return c.json(unauthorized, 401);
  const user = await c.var.deps.verifyUserToken(token);
  if (!user) return c.json(unauthorized, 401);
  c.set('user', user);
  await next();
});
