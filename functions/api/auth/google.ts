import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createSession, sessionSetCookie, upsertAccount } from '../../_lib/auth';
import type { Env } from '../../_lib/env';
import { errorResponse, json, readJsonObject } from '../../_lib/http';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GOOGLE_CLIENT_ID) return errorResponse(500, 'server_not_configured');
  const body = await readJsonObject(request);
  const credential = body?.credential;
  if (typeof credential !== 'string' || credential.length === 0 || credential.length > 8192) {
    return errorResponse(400, 'invalid_body');
  }

  let sub: string;
  let email: string | null = null;
  let name: string | null = null;
  try {
    // jwtVerify checks the signature, `exp` / `nbf`, `iss` (either Google form) and `aud`.
    const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
      issuer: GOOGLE_ISSUERS,
      audience: env.GOOGLE_CLIENT_ID,
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('no sub');
    sub = payload.sub;
    if (typeof payload.email === 'string') email = payload.email;
    if (typeof payload.name === 'string') name = payload.name;
  } catch {
    return errorResponse(401, 'invalid_credential');
  }

  const accountId = await upsertAccount(env, sub, email, name);
  const token = await createSession(env, accountId);
  return json({ id: accountId, email, display_name: name }, 200, {
    'set-cookie': sessionSetCookie(request, token),
  });
};
