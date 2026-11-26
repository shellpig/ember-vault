import { IDENTITY_HEADER, RESUME_HEADER, RESUME_TOKEN_PATTERN, type VerifiedIdentity } from '../../../../shared/room';
import { getAuthedAccount } from '../../../_lib/auth';
import { getCharacterRow } from '../../../_lib/characters';
import type { Env } from '../../../_lib/env';
import { errorResponse, hasAllowedOrigin } from '../../../_lib/http';
import { isValidRoomCode, roomStub } from '../../../_lib/rooms';

/**
 * GET /api/rooms/:code/ws?characterId=...
 * - With `Upgrade: websocket`: verifies session + character ownership and hands the connection to the Room DO.
 * - Without it: the same checks and the DO's room checks as a dry run, answering 200 / 401 / 403 / 404 / 409 so
 *   the browser can show a precise error (a failed WebSocket handshake does not expose the HTTP status).
 * The DO never sees anything the browser sent except through the verified identity header built here.
 */
export const onRequestGet: PagesFunction<Env, 'code'> = async ({ request, env, params }) => {
  if (!hasAllowedOrigin(request, env.DEV_AUTH)) return errorResponse(403, 'bad_origin');

  const account = await getAuthedAccount(request, env);
  if (!account) return errorResponse(401, 'unauthorized');

  const code = String(params.code ?? '').toUpperCase();
  if (!isValidRoomCode(code)) return errorResponse(404, 'room_not_found');

  const characterId = new URL(request.url).searchParams.get('characterId') ?? '';
  const row = characterId ? await getCharacterRow(env, account.id, characterId) : null;
  if (!row) return errorResponse(403, 'forbidden');

  const identity: VerifiedIdentity = {
    accountId: account.id,
    characterId: row.id,
    name: row.name,
    classId: row.class_id,
    maxDepth: row.max_depth,
  };

  // Build the headers for the DO from scratch: drop the cookie and any x-ev-* the browser may have sent.
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  for (const key of [...headers.keys()]) if (key.toLowerCase().startsWith('x-ev-')) headers.delete(key);
  headers.set(IDENTITY_HEADER, encodeURIComponent(JSON.stringify(identity)));

  // P7: the host page's resume token (query `resume`) travels as its own header; the DO treats it as an extra check only
  const url = new URL(request.url);
  const resume = url.searchParams.get('resume') ?? '';
  if (RESUME_TOKEN_PATTERN.test(resume)) headers.set(RESUME_HEADER, resume);
  url.search = '';
  return roomStub(env, code).fetch(new Request(url.toString(), { method: 'GET', headers }));
};

export const onRequest: PagesFunction<Env> = async () => errorResponse(405, 'method_not_allowed');
