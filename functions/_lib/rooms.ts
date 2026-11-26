import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_PATTERN } from '../../shared/room';
import type { Env } from './env';

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

/** Random room code; rejection sampling keeps every symbol equally likely. */
export function generateRoomCode(): string {
  const n = ROOM_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < ROOM_CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH * 2))) {
      if (b < limit && out.length < ROOM_CODE_LENGTH) out += ROOM_CODE_ALPHABET[b % n];
    }
  }
  return out;
}

export function roomStub(env: Env, code: string): DurableObjectStub {
  return env.ROOM.get(env.ROOM.idFromName(code));
}
