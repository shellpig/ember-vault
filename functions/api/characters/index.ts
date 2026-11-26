import { getAuthedAccount, nowSec } from '../../_lib/auth';
import { rowToSave } from '../../_lib/characters';
import type { Env } from '../../_lib/env';
import { errorResponse, json, readJsonObject } from '../../_lib/http';
import { isValidClassId, validateCharacterName } from '../../_lib/validate';
import { MAX_CHARACTERS_PER_ACCOUNT, emptyUpgrades } from '../../../shared/character';
import type { CharacterSummary } from '../../../shared/character';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const account = await getAuthedAccount(request, env);
  if (!account) return errorResponse(401, 'unauthorized');
  const { results } = await env.DB.prepare(
    `SELECT id, name, class_id, gold, max_depth, updated_at
       FROM characters WHERE account_id = ? ORDER BY created_at ASC, id ASC`
  )
    .bind(account.id)
    .all<CharacterSummary>();
  return json({ characters: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const account = await getAuthedAccount(request, env);
  if (!account) return errorResponse(401, 'unauthorized');

  const body = await readJsonObject(request);
  if (!body) return errorResponse(400, 'invalid_body');
  const name = validateCharacterName(body.name);
  if (!name.ok) return errorResponse(400, name.error);
  if (!isValidClassId(body.class_id)) return errorResponse(400, 'invalid_class');

  const id = crypto.randomUUID();
  const now = nowSec();
  // Conditional insert keeps the 8-character cap atomic even with concurrent requests.
  const res = await env.DB.prepare(
    `INSERT INTO characters
       (id, account_id, name, class_id, gold, max_depth, potions, upgrades, equipped, bag, stash,
        save_version, created_at, updated_at)
     SELECT ?, ?, ?, ?, 0, 1, 3, ?, '[]', '[]', '[]', 0, ?, ?
      WHERE (SELECT COUNT(*) FROM characters WHERE account_id = ?) < ?`
  )
    .bind(id, account.id, name.value, body.class_id, JSON.stringify(emptyUpgrades()), now, now, account.id, MAX_CHARACTERS_PER_ACCOUNT)
    .run();
  if (res.meta.changes !== 1) return errorResponse(409, 'character_limit');

  const row = await env.DB.prepare('SELECT * FROM characters WHERE id = ?').bind(id).first<Parameters<typeof rowToSave>[0]>();
  if (!row) return errorResponse(500, 'create_failed');
  return json(rowToSave(row), 201);
};
