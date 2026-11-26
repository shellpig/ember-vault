import type { Env } from '../_lib/env';
import { errorResponse } from '../_lib/http';

/**
 * CSRF defence in depth on top of the SameSite=Lax cookie: state-changing requests that carry an
 * Origin header must come from the same origin as the API (not enforced in local dev, see below).
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const method = request.method.toUpperCase();
  // Skipped when DEV_AUTH=1 (local dev): the Vite dev proxy on :3000 forwards a different Origin than the API's.
  if (context.env.DEV_AUTH !== '1' && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) {
      return errorResponse(403, 'bad_origin');
    }
  }
  return context.next();
};
