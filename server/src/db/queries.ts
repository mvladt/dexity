import { sqlite } from './client.js';

export interface ChatRow {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: number;
  chatId: number;
  role: 'user' | 'assistant';
  content: string;
  thinking: string | null;
  toolData: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: string;
}

const CHAT_COLUMNS = `id, user_id AS userId, title, created_at AS createdAt, updated_at AS updatedAt`;
const MESSAGE_COLUMNS = `id, chat_id AS chatId, role, content, thinking, tool_data AS toolData, prompt_tokens AS promptTokens, completion_tokens AS completionTokens, created_at AS createdAt`;

export function listChats(userId: number): ChatRow[] {
  return sqlite
    .prepare(`SELECT ${CHAT_COLUMNS} FROM chats WHERE user_id = ? ORDER BY updated_at DESC`)
    .all(userId) as unknown as ChatRow[];
}

export function createChat(userId: number, title: string): ChatRow {
  return sqlite
    .prepare(`INSERT INTO chats (user_id, title) VALUES (?, ?) RETURNING ${CHAT_COLUMNS}`)
    .get(userId, title) as unknown as ChatRow;
}

export function renameChat(id: number, title: string): ChatRow | undefined {
  return sqlite
    .prepare(`UPDATE chats SET title = ? WHERE id = ? RETURNING ${CHAT_COLUMNS}`)
    .get(title, id) as unknown as ChatRow | undefined;
}

export function deleteChat(id: number): boolean {
  const result = sqlite.prepare(`DELETE FROM chats WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getChatId(id: number): number | undefined {
  const row = sqlite.prepare(`SELECT id FROM chats WHERE id = ?`).get(id) as { id: number } | undefined;
  return row?.id;
}

export function touchChat(id: number): void {
  sqlite.prepare(`UPDATE chats SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

export function retitleChat(id: number, title: string): void {
  sqlite.prepare(`UPDATE chats SET title = ?, updated_at = datetime('now') WHERE id = ?`).run(title, id);
}

export function listMessages(chatId: number): MessageRow[] {
  return sqlite
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? ORDER BY created_at ASC`)
    .all(chatId) as unknown as MessageRow[];
}

export function recentMessages(chatId: number, limit: number): MessageRow[] {
  return sqlite
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(chatId, limit) as unknown as MessageRow[];
}

export function insertUserMessage(chatId: number, content: string): void {
  sqlite.prepare(`INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', ?)`).run(chatId, content);
}

export function insertAssistantMessage(params: {
  chatId: number;
  content: string;
  thinking: string | null;
  toolData: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
}): number {
  const row = sqlite
    .prepare(
      `INSERT INTO messages (chat_id, role, content, thinking, tool_data, prompt_tokens, completion_tokens)
       VALUES (?, 'assistant', ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      params.chatId,
      params.content,
      params.thinking,
      params.toolData,
      params.promptTokens,
      params.completionTokens,
    ) as { id: number };
  return row.id;
}
