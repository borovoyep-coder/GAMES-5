CREATE TABLE student_accounts (
  owner_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  study_group TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
