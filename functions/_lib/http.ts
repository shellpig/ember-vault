export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, status);
}

const MAX_BODY_BYTES = 1024 * 1024;

/** Reads a JSON object body. Returns null when the body is missing, too large or not a JSON object. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length === 0 || text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * CSRF / cross-site WebSocket defence: a request that carries an Origin header must come from the
 * same origin as the API. Skipped when DEV_AUTH=1 (local dev: the Vite proxy on :3000 forwards a
 * different Origin than the API's).
 */
export function hasAllowedOrigin(request: Request, devAuth: string | undefined): boolean {
  if (devAuth === '1') return true;
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
