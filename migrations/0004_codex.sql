-- Embervault relic codex (收集圖鑑): per-character list of registered relic template ids, stored as a JSON text array.
-- Spec: docs/multiplayer-spec.md section 1.5. Safe to run before the new Pages build is deployed
-- (old code never reads or writes the column; the default keeps existing characters at an empty codex).

ALTER TABLE characters ADD COLUMN codex TEXT NOT NULL DEFAULT '[]';
