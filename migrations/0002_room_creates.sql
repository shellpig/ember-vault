-- Embervault P7: room creation rate limit (POST /api/rooms, at most ROOM_CREATE_LIMIT.max per account per window).
-- Rows older than the window are pruned on every insert. See docs/multiplayer-spec.md section 5.3 (P7).

CREATE TABLE room_creates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    TEXT NOT NULL,
  created_at    INTEGER NOT NULL           -- unix milliseconds
);
CREATE INDEX idx_room_creates_account_time ON room_creates(account_id, created_at);
