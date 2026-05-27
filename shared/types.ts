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

export type PartSnapshot =
  | { type: 'thinking'; content: string }
  | { type: 'tool'; sources: Source[] };

export interface MessageToolData {
  sources?: Source[];
  // Источники, сгруппированные по tool_call: один массив на каждый вызов web_search.
  calls?: Source[][];
  // Снапшот последовательности партов в порядке появления — thinking₁, tool₁,
  // thinking₂, tool₂, …. Используется для воспроизведения interleaving'а после reload.
  parts?: PartSnapshot[];
}

export interface Message {
  id: number;
  chatId: number;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string | null;
  toolData?: MessageToolData | null;
  createdAt: string;
}

export type SSEEvent =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'delta'; delta: string }
  | {
      type: 'tool';
      tool: {
        name: 'web';
        status: 'loading' | 'success' | 'error';
        callId: number;
        sources?: Source[];
      };
    }
  | {
      type: 'done';
      fullContent: string;
      fullThinking?: string;
      fullTool?: MessageToolData;
      assistantMessageId: number;
      chatTitle?: string;
    }
  | { type: 'error'; code: 'auth' | 'quota' | 'server'; message: string };
