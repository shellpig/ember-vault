import type { Env } from '../_lib/env';
import { json } from '../_lib/http';

/** Public client config (no auth). The Google client id is public by design. */
export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  json({ googleClientId: env.GOOGLE_CLIENT_ID ?? '' });
