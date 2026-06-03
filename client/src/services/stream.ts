import type { MessageToolData, SSEEvent } from '../types';
import { useAuthStore } from '../stores/authStore';

const BASE = import.meta.env.VITE_API_URL ?? '';

interface StreamCallbacks {
  onThinkingDelta?: (delta: string) => void;
  onDelta: (delta: string) => void;
  onTool?: (tool: Extract<SSEEvent, { type: 'tool' }>['tool']) => void;
  onDone: (
    fullContent: string,
    assistantMessageId: number,
    fullThinking?: string,
    fullTool?: MessageToolData,
    chatTitle?: string,
    usage?: { promptTokens: number; completionTokens: number },
  ) => void;
  onError: (code: 'auth' | 'quota' | 'server', message: string) => void;
  signal?: AbortSignal;
  model?: string;
  systemPrompt?: string;
  webSearch?: boolean;
}

export async function streamMessages(
  chatId: number,
  content: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  const token = useAuthStore.getState().token;
  const signal = callbacks.signal;

  let res: Response;
  try {
    res = await fetch(`${BASE}/api/chats/${chatId}/messages/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        content,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(callbacks.model ? { model: callbacks.model } : {}),
        ...(callbacks.systemPrompt ? { systemPrompt: callbacks.systemPrompt } : {}),
        ...(callbacks.webSearch ? { webSearch: true } : {}),
      }),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    callbacks.onError('server', 'Сервис недоступен, попробуйте позже');
    return;
  }

  if (!res.ok) {
    if (res.status === 401) {
      useAuthStore.getState().clearToken();
      window.location.href = '/login';
      callbacks.onError('auth', 'Unauthorized');
    } else if (res.status === 404) {
      callbacks.onError('server', 'Chat not found');
    } else {
      callbacks.onError('server', 'Network error');
    }
    return;
  }

  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += value;
      const blocks = buf.split('\n\n');
      buf = blocks.pop() ?? '';

      for (const block of blocks) {
        for (const line of block.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          let event: SSEEvent;
          try {
            event = JSON.parse(line.slice(6)) as SSEEvent;
          } catch {
            continue;
          }

          if (event.type === 'thinking_delta') {
            callbacks.onThinkingDelta?.(event.delta);
          } else if (event.type === 'delta') {
            callbacks.onDelta(event.delta);
          } else if (event.type === 'tool') {
            callbacks.onTool?.(event.tool);
          } else if (event.type === 'done') {
            callbacks.onDone(
              event.fullContent,
              event.assistantMessageId,
              event.fullThinking,
              event.fullTool,
              event.chatTitle,
              event.usage,
            );
          } else if (event.type === 'error') {
            callbacks.onError(event.code, event.message);
          }
        }
      }
    }
  } catch {
    if (signal?.aborted) return;
    callbacks.onError('server', 'Соединение прервано');
  }
}
