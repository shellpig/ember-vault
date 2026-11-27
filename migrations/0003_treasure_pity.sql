-- Embervault treasure room: per-character pity counter (consecutive dungeon floors built without a treasure room).
-- Spec: docs/treasure-room-spec.md sections 1 and 7. Safe to run before the new Pages build is deployed
-- (old code never reads or writes the column; the default keeps existing characters at 0).

ALTER TABLE characters ADD COLUMN treasure_pity INTEGER NOT NULL DEFAULT 0;
