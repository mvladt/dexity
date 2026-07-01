import type { DatabaseSync } from 'node:sqlite';

export function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chats (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL DEFAULT 1,
      title      TEXT    NOT NULL DEFAULT 'Новый чат',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role       TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
      content    TEXT    NOT NULL,
      thinking   TEXT,
      tool_data  TEXT,
      prompt_tokens     INTEGER,
      completion_tokens INTEGER,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id      ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chats_user_id         ON chats(user_id);

    INSERT OR IGNORE INTO users (id) VALUES (1);
  `);

  // ALTER для уже существующих БД (новые колонки messages)
  const cols = db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('thinking')) db.exec(`ALTER TABLE messages ADD COLUMN thinking TEXT`);
  if (!names.has('tool_data')) db.exec(`ALTER TABLE messages ADD COLUMN tool_data TEXT`);
  if (!names.has('prompt_tokens')) db.exec(`ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER`);
  if (!names.has('completion_tokens')) db.exec(`ALTER TABLE messages ADD COLUMN completion_tokens INTEGER`);
}
