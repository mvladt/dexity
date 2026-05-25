export interface Chat {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: number;
  chatId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export type SSEEvent =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'delta'; delta: string }
  | { type: 'done'; fullContent: string; assistantMessageId: number; chatTitle?: string }
  | { type: 'error'; code: 'auth' | 'quota' | 'server'; message: string };
