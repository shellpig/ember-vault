import { getAuthedAccount } from '../_lib/auth';
import type { Env } from '../_lib/env';
import { errorResponse, json } from '../_lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const account = await getAuthedAccount(request, env);
  if (!account) return errorResponse(401, 'unauthorized');
  return json(account);
};
