export interface Env {
  DB: D1Database;
  /** Google OAuth Web client id (from wrangler.toml [vars]; also served via /api/config). */
  GOOGLE_CLIENT_ID: string;
  /** Set to "1" ONLY for local development to enable POST /api/auth/dev. */
  DEV_AUTH?: string;
}
