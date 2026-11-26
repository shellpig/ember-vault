import type { Env } from './env';

export const SESSION_COOKIE = 'ev_session';
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

export interface AuthedAccount {
  id: string;
  email: string | null;
  display_name: string | null;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

/** Secure is dropped only on plain http (local `wrangler pages dev`), so Safari can keep the cookie. */
function cookieAttrs(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `; HttpOnly${secure}; SameSite=Lax; Path=/`;
}

export function sessionSetCookie(request: Request, token: string): string {
  return `${SESSION_COOKIE}=${token}${cookieAttrs(request)}; Max-Age=${SESSION_MAX_AGE_SEC}`;
}

export function sessionClearCookie(request: Request): string {
  return `${SESSION_COOKIE}=${cookieAttrs(request)}; Max-Age=0`;
}

/** Creates a session for the account and returns the raw token (only its hash is stored). */
export async function createSession(env: Env, accountId: string): Promise<string> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sha256Hex(token);
  const now = nowSec();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)').bind(
      hash,
      accountId,
      now + SESSION_MAX_AGE_SEC
    ),
  ]);
  return token;
}

export async function getAuthedAccount(request: Request, env: Env): Promise<AuthedAccount | null> {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT a.id AS id, a.email AS email, a.display_name AS display_name
       FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(hash, nowSec())
    .first<AuthedAccount>();
  return row ?? null;
}

export async function destroySession(request: Request, env: Env): Promise<void> {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .run();
}

/** Finds or creates the account for a Google `sub` and refreshes email / display name. */
export async function upsertAccount(
  env: Env,
  googleSub: string,
  email: string | null,
  displayName: string | null
): Promise<string> {
  await env.DB.prepare(
    `INSERT INTO accounts (id, google_sub, email, display_name, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name`
  )
    .bind(crypto.randomUUID(), googleSub, email, displayName, nowSec())
    .run();
  const row = await env.DB.prepare('SELECT id FROM accounts WHERE google_sub = ?')
    .bind(googleSub)
    .first<{ id: string }>();
  if (!row) throw new Error('account upsert failed');
  return row.id;
}
