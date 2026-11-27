// Convenience persistence of the single-player bot setup (localStorage only, never sent anywhere).
import { MAX_BOTS, SELECTABLE_CLASS_IDS, type HeroClassId } from './game/classes';

const STORAGE_KEY = 'embervault.botSetup.v1';

/** One entry per bot (0-3); the length is the number of bot teammates. */
export type BotSetup = HeroClassId[];

export function loadBotSetup(): BotSetup {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c): c is HeroClassId => SELECTABLE_CLASS_IDS.includes(c as HeroClassId))
      .slice(0, MAX_BOTS);
  } catch {
    return [];
  }
}

export function saveBotSetup(setup: BotSetup): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(setup.slice(0, MAX_BOTS)));
  } catch {
    // storage may be unavailable (private mode / quota): the setup is just not remembered
  }
}
