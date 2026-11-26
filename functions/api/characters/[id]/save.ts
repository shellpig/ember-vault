import { getAuthedAccount } from '../../../_lib/auth';
import { handleSave } from '../../../_lib/characters';
import type { Env } from '../../../_lib/env';
import { errorResponse } from '../../../_lib/http';

/** POST alias of PUT /api/characters/:id, because navigator.sendBeacon can only POST. */
export const onRequestPost: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  const account = await getAuthedAccount(request, env);
  if (!account) return errorResponse(401, 'unauthorized');
  return handleSave(request, env, account.id, String(params.id));
};
