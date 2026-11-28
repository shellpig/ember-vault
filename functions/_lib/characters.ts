import type { CharacterSave } from '../../shared/character';
import { emptyUpgrades } from '../../shared/character';
import type { RelicItem } from '../../src/game/relics';
import type { Env } from './env';
import { errorResponse, json, readJsonObject } from './http';
import { nowSec } from './auth';
import { validateSaveBody } from './validate';

interface CharacterRow {
  id: string;
  account_id: string;
  name: string;
  class_id: string;
  gold: number;
  max_depth: number;
  potions: number;
  upgrades: string;
  equipped: string;
  bag: string;
  stash: string;
  treasure_pity?: number | null;
  codex?: string | null;
  save_version: number;
  created_at: number;
  updated_at: number;
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function rowToSave(row: CharacterRow): CharacterSave {
  return {
    id: row.id,
    name: row.name,
    class_id: row.class_id,
    gold: row.gold,
    max_depth: row.max_depth,
    potions: row.potions,
    upgrades: { ...emptyUpgrades(), ...parseJson(row.upgrades, {}) },
    equipped: parseJson<RelicItem[]>(row.equipped, []),
    bag: parseJson<RelicItem[]>(row.bag, []),
    stash: parseJson<RelicItem[]>(row.stash, []),
    treasure_pity: row.treasure_pity ?? 0,
    codex: parseJson<string[]>(row.codex ?? '[]', []),
    save_version: row.save_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getCharacterRow(env: Env, accountId: string, id: string): Promise<CharacterRow | null> {
  return env.DB.prepare('SELECT * FROM characters WHERE id = ? AND account_id = ?')
    .bind(id, accountId)
    .first<CharacterRow>();
}

/** Shared by PUT /api/characters/:id and POST /api/characters/:id/save (sendBeacon). */
export async function handleSave(request: Request, env: Env, accountId: string, id: string): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(400, 'invalid_body');
  const v = validateSaveBody(body);
  if (!v.ok) return errorResponse(400, v.error);
  const s = v.value;

  const res = await env.DB.prepare(
    `UPDATE characters
        SET gold = ?, max_depth = MAX(max_depth, ?), potions = ?, upgrades = ?, equipped = ?, bag = ?,
            stash = COALESCE(?, stash), treasure_pity = COALESCE(?, treasure_pity), codex = COALESCE(?, codex), save_version = save_version + 1, updated_at = ?
      WHERE id = ? AND account_id = ? AND save_version = ?`
  )
    .bind(
      s.gold,
      s.maxDepth,
      s.potions,
      JSON.stringify(s.upgrades),
      JSON.stringify(s.equipped),
      JSON.stringify(s.bag),
      s.stash ? JSON.stringify(s.stash) : null,
      s.treasurePity,
      s.codex ? JSON.stringify(s.codex) : null,
      nowSec(),
      id,
      accountId,
      s.baseVersion
    )
    .run();

  if (res.meta.changes === 1) {
    return json({ save_version: s.baseVersion + 1 });
  }
  const row = await getCharacterRow(env, accountId, id);
  if (!row) return errorResponse(404, 'not_found');
  return errorResponse(409, 'version_conflict', { save_version: row.save_version });
}
