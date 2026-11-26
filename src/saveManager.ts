import { ApiError, api, beaconSave } from './api';
import type { CharacterLoadout } from './game/engine';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/**
 * Uploads one character's state to the cloud. Never blocks the game: requests are coalesced
 * (at most one PUT in flight, always sending the latest state) and failures only flip the status.
 * A 409 (stale base_version) pauses saving until the host resolves the conflict.
 */
export class SaveManager {
  private version: number;
  private inFlight = false;
  private dirty = false;
  private paused = false;
  private idleWaiters: Array<() => void> = [];

  constructor(
    readonly characterId: string,
    initialVersion: number,
    private readonly getState: () => CharacterLoadout | null,
    private readonly onStatus: (status: SaveStatus) => void
  ) {
    this.version = initialVersion;
  }

  /** Ask for a save. Safe to call at any frequency. */
  request(): void {
    if (this.paused) return;
    this.dirty = true;
    if (!this.inFlight) void this.run();
  }

  /** Resolves when no save is pending or in flight. */
  flush(): Promise<void> {
    if (!this.paused) this.request();
    if (!this.inFlight && !this.dirty) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Best-effort upload during pagehide. */
  beacon(): void {
    if (this.paused) return;
    const state = this.getState();
    if (!state) return;
    // If a PUT is already on the wire it will most likely land first and bump the version.
    beaconSave(this.characterId, state, this.inFlight ? this.version + 1 : this.version);
  }

  /** After a bfcache restore the beacon may have bumped the server version; resync it. */
  async resyncVersion(): Promise<void> {
    try {
      const save = await api.getCharacter(this.characterId);
      this.version = save.save_version;
    } catch {
      // ignore; the next save will report a conflict if we are really stale
    }
  }

  private async run(): Promise<void> {
    this.inFlight = true;
    try {
      while (this.dirty && !this.paused) {
        this.dirty = false;
        const state = this.getState();
        if (!state) break;
        this.onStatus('saving');
        try {
          const res = await api.saveCharacter(this.characterId, state, this.version);
          this.version = res.save_version;
          this.onStatus('saved');
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            this.paused = true;
            this.onStatus('conflict');
          } else {
            this.onStatus('error');
          }
          break;
        }
      }
    } finally {
      this.inFlight = false;
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }
}
