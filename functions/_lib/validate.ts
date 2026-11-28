import { SELECTABLE_CLASS_IDS } from '../../src/game/classes';
import type { RelicItem } from '../../src/game/relics';
import {
  CODEX_ID_PATTERN,
  CharacterUpgrades,
  MAX_BAG,
  MAX_CODEX_ENTRIES,
  MAX_EQUIPPED,
  MAX_NAME_LENGTH,
  MAX_STASH,
  MAX_TREASURE_PITY,
  UPGRADE_KEYS,
} from '../../shared/character';

const MAX_SAFE_GOLD = 1_000_000_000_000;
const MAX_DEPTH_LIMIT = 9999;
const MAX_UPGRADE_LEVEL = 999;
const MAX_POTIONS = 9999;
const MAX_ITEM_JSON_LENGTH = 8 * 1024;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isNonNegInt(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
}

export function isValidClassId(v: unknown): v is string {
  return typeof v === 'string' && (SELECTABLE_CLASS_IDS as string[]).includes(v);
}

export function validateCharacterName(v: unknown): Validated<string> {
  if (typeof v !== 'string') return fail('invalid_name');
  const name = v.trim();
  if (name.length < 1 || Array.from(name).length > MAX_NAME_LENGTH) return fail('invalid_name');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return fail('invalid_name');
  return { ok: true, value: name };
}

function validateRelicArray(v: unknown, cap: number, field: string): Validated<RelicItem[]> {
  if (!Array.isArray(v)) return fail(`invalid_${field}`);
  if (v.length > cap) return fail(`${field}_too_large`);
  const seen = new Set<string>();
  for (const item of v) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail(`invalid_${field}`);
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.templateId !== 'string') return fail(`invalid_${field}`);
    if (seen.has(r.id)) return fail(`duplicate_${field}`);
    seen.add(r.id);
    if (JSON.stringify(item).length > MAX_ITEM_JSON_LENGTH) return fail(`invalid_${field}`);
  }
  return { ok: true, value: v as RelicItem[] };
}

export function validateUpgrades(v: unknown): Validated<CharacterUpgrades> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('invalid_upgrades');
  const src = v as Record<string, unknown>;
  const out = {} as CharacterUpgrades;
  for (const key of UPGRADE_KEYS) {
    const n = src[key] ?? 0;
    if (!isNonNegInt(n, MAX_UPGRADE_LEVEL)) return fail('invalid_upgrades');
    out[key] = n;
  }
  return { ok: true, value: out };
}

export interface ValidatedSave {
  baseVersion: number;
  gold: number;
  maxDepth: number;
  potions: number;
  upgrades: CharacterUpgrades;
  equipped: RelicItem[];
  bag: RelicItem[];
  /** null = keep the stored stash. */
  stash: RelicItem[] | null;
  /** null = keep the stored treasure room pity counter. */
  treasurePity: number | null;
  /** null = keep the stored codex. */
  codex: string[] | null;
}

export function validateSaveBody(body: Record<string, unknown>): Validated<ValidatedSave> {
  const baseVersion = body.base_version;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return fail('invalid_base_version');
  }
  if (!isNonNegInt(body.gold, MAX_SAFE_GOLD)) return fail('invalid_gold');
  if (typeof body.max_depth !== 'number' || !Number.isInteger(body.max_depth) || body.max_depth < 1 || body.max_depth > MAX_DEPTH_LIMIT) {
    return fail('invalid_max_depth');
  }
  if (!isNonNegInt(body.potions, MAX_POTIONS)) return fail('invalid_potions');

  const upgrades = validateUpgrades(body.upgrades);
  if (!upgrades.ok) return upgrades;
  const equipped = validateRelicArray(body.equipped, MAX_EQUIPPED, 'equipped');
  if (!equipped.ok) return equipped;
  const bag = validateRelicArray(body.bag, MAX_BAG, 'bag');
  if (!bag.ok) return bag;

  let stash: RelicItem[] | null = null;
  if (body.stash !== undefined) {
    const s = validateRelicArray(body.stash, MAX_STASH, 'stash');
    if (!s.ok) return s;
    stash = s.value;
  }

  let treasurePity: number | null = null;
  if (body.treasure_pity !== undefined) {
    if (!isNonNegInt(body.treasure_pity, MAX_TREASURE_PITY)) return fail('invalid_treasure_pity');
    treasurePity = body.treasure_pity;
  }

  let codex: string[] | null = null;
  if (body.codex !== undefined) {
    if (!Array.isArray(body.codex) || body.codex.length > MAX_CODEX_ENTRIES) return fail('invalid_codex');
    const seen = new Set<string>();
    for (const id of body.codex) {
      if (typeof id !== 'string' || !CODEX_ID_PATTERN.test(id) || seen.has(id)) return fail('invalid_codex');
      seen.add(id);
    }
    codex = body.codex as string[];
  }

  // An item may not appear in two containers at once.
  const ids = new Set<string>();
  for (const list of [equipped.value, bag.value, stash ?? []]) {
    for (const item of list) {
      if (ids.has(item.id)) return fail('duplicate_item');
      ids.add(item.id);
    }
  }

  return {
    ok: true,
    value: {
      baseVersion,
      gold: body.gold,
      maxDepth: body.max_depth,
      potions: body.potions,
      upgrades: upgrades.value,
      equipped: equipped.value,
      bag: bag.value,
      stash,
      treasurePity,
      codex,
    },
  };
}
