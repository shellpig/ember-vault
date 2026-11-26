import { createSession, sessionSetCookie, upsertAccount } from '../../_lib/auth';
import type { Env } from '../../_lib/env';
import { errorResponse, json } from '../../_lib/http';

/**
 * Local-development login bypass. Only active when the env var DEV_AUTH is exactly "1"
 * (set in .dev.vars, never in the production Pages project). Otherwise answers 404.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (env.DEV_AUTH !== '1') return errorResponse(404, 'not_found');
  const accountId = await upsertAccount(env, 'dev-local-user', 'dev@localhost', 'Dev Player');
  const token = await createSession(env, accountId);
  return json({ id: accountId, email: 'dev@localhost', display_name: 'Dev Player' }, 200, {
    'set-cookie': sessionSetCookie(request, token),
  });
};

export const onRequest: PagesFunction<Env> = async ({ env }) => {
  // Any non-POST method.
  return errorResponse(env.DEV_AUTH === '1' ? 405 : 404, env.DEV_AUTH === '1' ? 'method_not_allowed' : 'not_found');
};
