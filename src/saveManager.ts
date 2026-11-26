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
  /** P6: a trade is open; D1 is the authority, so no upload may leave this client until it ends. */
  private held = false;
  /** The last upload failed for a reason other than a version conflict. */
  private failed = false;
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
    if (this.held) {
      this.dirty = true;
      return;
    }
    this.dirty = true;
    if (!this.inFlight) void this.run();
  }

  /** Resolves when no save is pending or in flight. */
  flush(): Promise<void> {
    if (this.held) return Promise.resolve(); // nothing leaves the client during a trade
    if (!this.paused) this.request();
    if (!this.inFlight && !this.dirty) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /**
   * P6: starts a trade hold. Flushes the current state first so D1 is up to date (a trade reads both saves from D1), then
   * blocks every upload until `endTrade`. Returns false (nothing held) when the flush did not succeed.
   */
  async beginTrade(): Promise<boolean> {
    if (this.paused) return false;
    await this.flush();
    if (this.paused || this.failed) return false;
    this.held = true;
    return true;
  }

  /** P6: the trade is over. `serverVersion` is the new save_version when the trade executed (the server state replaced ours). */
  endTrade(serverVersion?: number): void {
    this.held = false;
    if (serverVersion !== undefined) {
      this.version = serverVersion;
      this.dirty = false; // server state just replaced local state; no redundant PUT needed
    }
    if (this.dirty && !this.inFlight && !this.paused) void this.run();
  }

  /** Best-effort upload during pagehide. A held (trading) client never uploads: it could fail the trade or look stale. */
  beacon(): void {
    if (this.paused || this.held) return;
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
      while (this.dirty && !this.paused && !this.held) {
        this.dirty = false;
        const state = this.getState();
        if (!state) break;
        this.onStatus('saving');
        try {
          const res = await api.saveCharacter(this.characterId, state, this.version);
          this.version = res.save_version;
          this.failed = false;
          this.onStatus('saved');
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            this.paused = true;
            this.onStatus('conflict');
          } else {
            this.failed = true;
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
