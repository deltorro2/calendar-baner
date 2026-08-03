-- Prism task store.
--
-- One row per task, including deleted ones: a delete is a tombstone
-- (deleted = 1) so the deletion itself can travel to other devices.
-- `updated` is a millisecond timestamp and is the merge key — the newer
-- write for a given id wins on both sides.

CREATE TABLE IF NOT EXISTS tasks (
  id       TEXT    PRIMARY KEY,
  day      TEXT    NOT NULL,               -- 'YYYY-MM-DD'
  title    TEXT    NOT NULL,
  done     INTEGER NOT NULL DEFAULT 0,     -- 0 | 1
  position INTEGER NOT NULL DEFAULT 0,     -- order within the day
  updated  INTEGER NOT NULL,               -- ms since epoch
  deleted  INTEGER NOT NULL DEFAULT 0      -- 0 | 1 (tombstone)
);

-- Every sync asks the same question: "what changed since X?"
CREATE INDEX IF NOT EXISTS tasks_by_updated ON tasks (updated);

-- Rendering a week reads day by day.
CREATE INDEX IF NOT EXISTS tasks_by_day ON tasks (day) WHERE deleted = 0;
