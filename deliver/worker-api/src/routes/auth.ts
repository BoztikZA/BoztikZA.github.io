import type { Env } from "../types";
import { HttpError } from "../types";
import {
  assertLoginAllowed, authenticate, clearLoginFailures, createSession, recordLoginFailure,
  requireSession, revokeSession,
} from "../lib/auth";
import { assertSameSiteOrigin, clientIp, error, json, readJson, requireJson, segments, wrap } from "./util";

export function handleAuth(request: Request, path: string, env: Env): Promise<Response> {
  return wrap(async () => {
    const parts = segments(path); // ['login'] | ['logout'] | ['me']
    const action = parts[0];

    if (action === "login") {
      if (request.method !== "POST") return error("Method not allowed", 405);
      return login(request, env);
    }
    if (action === "logout") {
      if (request.method !== "POST") return error("Method not allowed", 405);
      await revokeSession(request, env);
      return json({ ok: true });
    }
    if (action === "me") {
      if (request.method !== "GET") return error("Method not allowed", 405);
      const email = await requireSession(request, env);
      return json({ ok: true, user: { email } });
    }
    return error("Not found", 404);
  });
}

async function login(request: Request, env: Env): Promise<Response> {
  requireJson(request);
  assertSameSiteOrigin(request, env);
  const ip = clientIp(request);
  await assertLoginAllowed(env, ip);

  const body = await readJson(request, 4 * 1024);
  const username = typeof body.username === "string" ? body.username.trim().slice(0, 256) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
  if (!username || !password) throw new HttpError(400, "missing_credentials", "Enter your email and password.");

  if (!(await authenticate(env, username, password))) {
    await recordLoginFailure(env, ip);
    throw new HttpError(401, "invalid_credentials", "Incorrect email or password.");
  }
  await clearLoginFailures(env, ip);
  const session = await createSession(env, env.ADMIN_USERNAME);
  return json({
    ok: true,
    token: session.token,
    expires_at: new Date(session.expires_at * 1000).toISOString(),
    user: { email: session.email },
  });
}
