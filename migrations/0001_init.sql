-- Embervault P1: accounts, sessions, characters, trades (trades is reserved for P6).
-- See docs/multiplayer-spec.md section 8.1.

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,          -- uuid
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT,
  display_name  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,          -- sha256(token), hex
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  expires_at    INTEGER NOT NULL           -- unix seconds
);
CREATE INDEX idx_sessions_account ON sessions(account_id);

CREATE TABLE characters (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  name          TEXT NOT NULL,
  class_id      TEXT NOT NULL,             -- 'warrior' | 'frost_mage' | ...
  gold          INTEGER NOT NULL DEFAULT 0,
  max_depth     INTEGER NOT NULL DEFAULT 1,
  potions       INTEGER NOT NULL DEFAULT 3,
  upgrades      TEXT NOT NULL,             -- JSON
  equipped      TEXT NOT NULL,             -- JSON RelicItem[] (<=4)
  bag           TEXT NOT NULL,             -- JSON RelicItem[] (<=30)
  stash         TEXT NOT NULL,             -- JSON RelicItem[] (<=200)
  save_version  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_characters_account ON characters(account_id);

CREATE TABLE trades (
  id            TEXT PRIMARY KEY,
  char_a        TEXT NOT NULL,
  char_b        TEXT NOT NULL,
  payload       TEXT NOT NULL,             -- JSON: what each side handed over
  created_at    INTEGER NOT NULL
);
