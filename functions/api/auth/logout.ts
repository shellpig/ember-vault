import { destroySession, sessionClearCookie } from '../../_lib/auth';
import type { Env } from '../../_lib/env';
import { json } from '../../_lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  await destroySession(request, env);
  return json({ ok: true }, 200, { 'set-cookie': sessionClearCookie(request) });
};
