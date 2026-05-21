export interface Chat {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

export interface Message {
  id: number;
  chatId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  sources?: Source[];
}

export type SSEEvent =
  | { type: 'delta'; delta: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'done'; fullContent: string; assistantMessageId: number; chatTitle?: string }
  | { type: 'error'; code: 'auth' | 'quota' | 'server'; message: string };
