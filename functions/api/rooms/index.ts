import { getAuthedAccount } from '../../_lib/auth';
import { getCharacterRow } from '../../_lib/characters';
import type { Env } from '../../_lib/env';
import { errorResponse, json, readJsonObject } from '../../_lib/http';
import { generateRoomCode, roomStub } from '../../_lib/rooms';

const MAX_CODE_ATTEMPTS = 6;

/** POST /api/rooms { characterId } -> { code }. Creates an empty room owned by the caller (the host). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const account = await getAuthedAccount(request, env);
  if (!account) return errorResponse(401, 'unauthorized');
  const body = await readJsonObject(request);
  const characterId = body?.characterId;
  if (typeof characterId !== 'string' || characterId.length === 0 || characterId.length > 64) {
    return errorResponse(400, 'invalid_body');
  }
  const row = await getCharacterRow(env, account.id, characterId);
  if (!row) return errorResponse(403, 'forbidden');

  for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
    const code = generateRoomCode();
    const res = await roomStub(env, code).fetch('https://room/init', {
      method: 'POST',
      headers: { 'x-ev-host-account': account.id },
    });
    if (res.ok) return json({ code });
    if (res.status !== 409) return errorResponse(502, 'room_unavailable');
    // 409 = code already in use: try another one.
  }
  return errorResponse(503, 'no_free_code');
};

export const onRequest: PagesFunction<Env> = async () => errorResponse(405, 'method_not_allowed');
