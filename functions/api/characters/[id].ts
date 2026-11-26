import { getAuthedAccount } from '../../_lib/auth';
import { getCharacterRow, handleSave, rowToSave } from '../../_lib/characters';
import type { Env } from '../../_lib/env';
import { errorResponse, json } from '../../_lib/http';

export const onRequestGet: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  const account = await getAuthedAccount(request, env);
  if (!account) return errorResponse(401, 'unauthorized');
  const row = await getCharacterRow(env, account.id, String(params.id));
  if (!row) return errorResponse(404, 'not_found');
  return json(rowToSave(row));
};

export const onRequestPut: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  const account = await getAuthedAccount(request, env);
  if (!account) return errorResponse(401, 'unauthorized');
  return handleSave(request, env, account.id, String(params.id));
};

export const onRequestDelete: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  const account = await getAuthedAccount(request, env);
  if (!account) return errorResponse(401, 'unauthorized');
  const res = await env.DB.prepare('DELETE FROM characters WHERE id = ? AND account_id = ?')
    .bind(String(params.id), account.id)
    .run();
  if (res.meta.changes !== 1) return errorResponse(404, 'not_found');
  return json({ ok: true });
};
