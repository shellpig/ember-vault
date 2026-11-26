import { createSession, sessionSetCookie, upsertAccount } from '../../_lib/auth';
import type { Env } from '../../_lib/env';
import { errorResponse, json, readJsonObject } from '../../_lib/http';

/** Accepted fake users (body `{ user }`). `dev1` is the original account (google_sub `dev-local-user`). */
const DEV_USER = /^dev([1-8])$/;

/**
 * Local-development login bypass. Only active when the env var DEV_AUTH is exactly "1"
 * (set in .dev.vars, never in the production Pages project). Otherwise answers 404.
 * Optional JSON body `{ "user": "dev1" .. "dev8" }` picks one of several fake accounts (multiplayer testing).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (env.DEV_AUTH !== '1') return errorResponse(404, 'not_found');
  const body = await readJsonObject(request); // null when there is no body -> dev1
  const requested = body?.user;
  let n = 1;
  if (requested !== undefined) {
    const m = typeof requested === 'string' ? DEV_USER.exec(requested) : null;
    if (!m) return errorResponse(400, 'invalid_dev_user');
    n = Number(m[1]);
  }
  const sub = n === 1 ? 'dev-local-user' : `dev-local-user-${n}`;
  const email = n === 1 ? 'dev@localhost' : `dev${n}@localhost`;
  const displayName = n === 1 ? 'Dev Player' : `Dev Player ${n}`;
  const accountId = await upsertAccount(env, sub, email, displayName);
  const token = await createSession(env, accountId);
  return json({ id: accountId, email, display_name: displayName }, 200, {
    'set-cookie': sessionSetCookie(request, token),
  });
};

export const onRequest: PagesFunction<Env> = async ({ env }) => {
  // Any non-POST method.
  return errorResponse(env.DEV_AUTH === '1' ? 405 : 404, env.DEV_AUTH === '1' ? 'method_not_allowed' : 'not_found');
};
