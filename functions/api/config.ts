import type { Env } from '../_lib/env';
import { json } from '../_lib/http';

/**
 * Public client config (no auth). The Google client id is public by design. `devAuth` tells the client it talks to a local
 * dev backend (DEV_AUTH=1 in .dev.vars, never set in production), which unlocks dev-only URL parameters such as `?devDepth=N`.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  json({ googleClientId: env.GOOGLE_CLIENT_ID ?? '', devAuth: env.DEV_AUTH === '1' });
