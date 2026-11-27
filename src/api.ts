// Thin client for the Pages Functions API (see functions/api and docs/multiplayer-spec.md section 8.2).

import type { CharacterLoadout } from './game/engine';
import type { CharacterSave, CharacterSummary, MeResponse } from '../shared/character';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: Record<string, unknown>;
  constructor(status: number, code: string, data: Record<string, unknown>) {
    super(`API ${status}: ${code}`);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON error body (e.g. dev server without the API running)
  }
  if (!res.ok) {
    throw new ApiError(res.status, typeof data.error === 'string' ? data.error : 'http_error', data);
  }
  return data as T;
}

/** Body of PUT /api/characters/:id. Always includes the full stash (the server only keeps its stored one when the field is absent). */
export function buildSaveBody(state: CharacterLoadout, baseVersion: number) {
  return {
    base_version: baseVersion,
    gold: Math.max(0, Math.floor(state.gold)),
    max_depth: Math.max(1, Math.floor(state.maxDepth)),
    potions: Math.max(0, Math.floor(state.potions)),
    upgrades: state.upgrades,
    equipped: state.equipped,
    bag: state.bag,
    stash: state.stash,
    // Omitted (server keeps its value) when the loadout does not carry a counter
    ...(state.treasurePity === undefined ? {} : { treasure_pity: Math.max(0, Math.floor(state.treasurePity)) }),
  };
}

export function saveToLoadout(save: CharacterSave): CharacterLoadout {
  return {
    gold: save.gold,
    maxDepth: save.max_depth,
    potions: save.potions,
    upgrades: save.upgrades,
    equipped: save.equipped,
    bag: save.bag,
    stash: save.stash,
    treasurePity: save.treasure_pity ?? 0,
  };
}

export const api = {
  config: () => request<{ googleClientId: string; devAuth?: boolean }>('GET', '/api/config'),
  me: () => request<MeResponse>('GET', '/api/me'),
  googleLogin: (credential: string) => request<MeResponse>('POST', '/api/auth/google', { credential }),
  devLogin: (user?: string) => request<MeResponse>('POST', '/api/auth/dev', user ? { user } : undefined),
  createRoom: (characterId: string) => request<{ code: string }>('POST', '/api/rooms', { characterId }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  listCharacters: () => request<{ characters: CharacterSummary[] }>('GET', '/api/characters'),
  createCharacter: (name: string, classId: string) =>
    request<CharacterSave>('POST', '/api/characters', { name, class_id: classId }),
  getCharacter: (id: string) => request<CharacterSave>('GET', `/api/characters/${encodeURIComponent(id)}`),
  deleteCharacter: (id: string) => request<{ ok: true }>('DELETE', `/api/characters/${encodeURIComponent(id)}`),
  saveCharacter: (id: string, state: CharacterLoadout, baseVersion: number) =>
    request<{ save_version: number }>('PUT', `/api/characters/${encodeURIComponent(id)}`, buildSaveBody(state, baseVersion)),
};

/** Fire-and-forget save for page unload (sendBeacon can only POST, hence the /save alias route). */
export function beaconSave(id: string, state: CharacterLoadout, baseVersion: number): boolean {
  if (typeof navigator.sendBeacon !== 'function') return false;
  const blob = new Blob([JSON.stringify(buildSaveBody(state, baseVersion))], { type: 'application/json' });
  return navigator.sendBeacon(`/api/characters/${encodeURIComponent(id)}/save`, blob);
}
