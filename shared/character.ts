// Types and limits shared by the Pages Functions (server) and the game client.
// Keep this file free of DOM / Workers specific APIs.

import type { RelicItem } from '../src/game/relics';

export const MAX_CHARACTERS_PER_ACCOUNT = 8;
export const MAX_EQUIPPED = 4;
export const MAX_BAG = 30;
export const MAX_STASH = 200;
export const MAX_NAME_LENGTH = 16;

/** Gold-upgrade levels. Warrior uses hp/atk/armor/crit, Frost Mage uses hpShield/atk/crit/shieldSpeed. */
export interface CharacterUpgrades {
  hp: number;
  atk: number;
  armor: number;
  crit: number;
  hpShield: number;
  shieldSpeed: number;
}

export const UPGRADE_KEYS: ReadonlyArray<keyof CharacterUpgrades> = [
  'hp',
  'atk',
  'armor',
  'crit',
  'hpShield',
  'shieldSpeed',
];

export function emptyUpgrades(): CharacterUpgrades {
  return { hp: 0, atk: 0, armor: 0, crit: 0, hpShield: 0, shieldSpeed: 0 };
}

/** Persisted part of a character (what the client uploads on PUT). */
export interface CharacterState {
  gold: number;
  max_depth: number;
  potions: number;
  upgrades: CharacterUpgrades;
  equipped: RelicItem[];
  bag: RelicItem[];
  /** Optional on upload: when omitted the server keeps the stored stash (the P2+ client always sends it). */
  stash?: RelicItem[];
}

export interface CharacterSummary {
  id: string;
  name: string;
  class_id: string;
  gold: number;
  max_depth: number;
  updated_at: number;
}

/** Full save as returned by GET /api/characters/:id. */
export interface CharacterSave extends CharacterSummary {
  potions: number;
  upgrades: CharacterUpgrades;
  equipped: RelicItem[];
  bag: RelicItem[];
  stash: RelicItem[];
  save_version: number;
  created_at: number;
}

export interface MeResponse {
  id: string;
  email: string | null;
  display_name: string | null;
}
