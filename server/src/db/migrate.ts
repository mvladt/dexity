import type Database from 'better-sqlite3';

export function migrate(db: Database.Database) {
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
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id      ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chats_user_id         ON chats(user_id);

    INSERT OR IGNORE INTO users (id) VALUES (1);
  `);
}
