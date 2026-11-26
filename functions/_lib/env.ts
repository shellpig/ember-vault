export interface Env {
  DB: D1Database;
  /** Google OAuth Web client id (same value as the frontend VITE_GOOGLE_CLIENT_ID). */
  GOOGLE_CLIENT_ID: string;
  /** Set to "1" ONLY for local development to enable POST /api/auth/dev. */
  DEV_AUTH?: string;
}
