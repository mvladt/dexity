import { create } from 'zustand';
import { streamMessages } from '../services/stream';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';
import type { MessageToolData, PartSnapshot, Source, SSEEvent } from '../types';

export type ToolState =
  | { kind: 'web'; status: 'loading'; query: string }
  | { kind: 'web'; status: 'success'; query: string; sources: Source[] }
  | { kind: 'web'; status: 'error'; query: string }
  | { kind: 'fetch'; status: 'loading'; url: string }
  | { kind: 'fetch'; status: 'success'; url: string; title?: string; content?: string }
  | { kind: 'fetch'; status: 'error'; url: string };

export type StreamPart =
  | { type: 'thinking'; content: string }
  | { type: 'tool'; callId: number; state: ToolState }
  | { type: 'text'; content: string };

interface StreamStore {
  streaming: boolean;
  parts: StreamPart[];
  error: { code: 'auth' | 'quota' | 'server'; message: string } | null;
  startStream: (chatId: number, content: string) => Promise<void>;
  cancel: () => void;
  clearError: () => void;
}

let abortController: AbortController | null = null;

const INITIAL = { parts: [] as StreamPart[] };

// Сворачивает live-парты стрима в формат сохранённого сообщения. Нужно при
// паузе: фиксируем недописанный ответ локально (сервер пишет свою версию в БД,
// она заменит локальную при следующем fetchMessages).
function partsToStored(parts: StreamPart[]): {
  content: string;
  thinking: string;
  toolData: MessageToolData | null;
} {
  let content = '';
  let thinking = '';
  const snapshot: PartSnapshot[] = [];
  for (const p of parts) {
    if (p.type === 'text') {
      content += p.content;
    } else if (p.type === 'thinking') {
      thinking += p.content;
      snapshot.push({ type: 'thinking', content: p.content });
    } else if (p.state.kind === 'fetch') {
      const st = p.state;
      snapshot.push(
        st.status === 'success'
          ? { type: 'fetch', url: st.url, title: st.title, content: st.content }
          : st.status === 'error'
            ? { type: 'fetch', url: st.url, error: true }
            : { type: 'fetch', url: st.url },
      );
    } else {
      const st = p.state;
      snapshot.push({ type: 'tool', query: st.query, sources: st.status === 'success' ? st.sources : [] });
    }
  }
  return { content, thinking, toolData: snapshot.length ? { parts: snapshot } : null };
}

export const useStreamStore = create<StreamStore>()((set, get) => ({
  streaming: false,
  ...INITIAL,
  error: null,

  clearError: () => set({ error: null }),

  cancel: () => {
    abortController?.abort();
    abortController = null;

    // Фиксируем недописанный ответ локально, чтобы он не пропал с экрана.
    // Временный id примирится с серверной версией при следующем fetchMessages.
    const chatId = useChatStore.getState().activeChat?.id;
    const { content, thinking, toolData } = partsToStored(get().parts);
    // Порог совпадает с серверным persistAssistant: сохраняем при наличии текста
    // или инструментов. Только thinking (без ответа) не фиксируем — иначе пузырь
    // исчезнет после refetch, т.к. сервер его не сохранит.
    const hasTool = toolData?.parts?.some((p) => p.type === 'tool' || p.type === 'fetch') ?? false;
    if (chatId && (content.trim() !== '' || hasTool)) {
      useChatStore.getState().appendMessage({
        id: Date.now(),
        chatId,
        role: 'assistant',
        content,
        thinking: thinking || null,
        toolData,
        createdAt: new Date().toISOString(),
      });
    }

    set({ streaming: false, ...INITIAL });
  },

  startStream: async (chatId, content) => {
    abortController = new AbortController();
    set({ streaming: true, ...INITIAL, error: null });
    const { appendMessage, patchChatTitle } = useChatStore.getState();

    const { model, systemPrompt } = useSettingsStore.getState();

    await streamMessages(chatId, content, {
      signal: abortController.signal,
      model,
      systemPrompt: systemPrompt || undefined,
      webSearch: true,

      onThinkingDelta: (delta) =>
        set((s) => {
          const parts = [...s.parts];
          const last = parts[parts.length - 1];
          if (last?.type === 'thinking') {
            parts[parts.length - 1] = { type: 'thinking', content: last.content + delta };
          } else {
            parts.push({ type: 'thinking', content: delta });
          }
          return { parts };
        }),

      onDelta: (delta) =>
        set((s) => {
          const parts = [...s.parts];
          const last = parts[parts.length - 1];
          if (last?.type === 'text') {
            parts[parts.length - 1] = { type: 'text', content: last.content + delta };
          } else {
            parts.push({ type: 'text', content: delta });
          }
          return { parts };
        }),

      onTool: (tool: Extract<SSEEvent, { type: 'tool' }>['tool']) => {
        let state: ToolState;
        if (tool.name === 'fetch') {
          const url = tool.url ?? '';
          state =
            tool.status === 'success'
              ? { kind: 'fetch', status: 'success', url, title: tool.title, content: tool.content }
              : tool.status === 'error'
                ? { kind: 'fetch', status: 'error', url }
                : { kind: 'fetch', status: 'loading', url };
        } else {
          const query = tool.query ?? '';
          state =
            tool.status === 'success'
              ? { kind: 'web', status: 'success', query, sources: tool.sources ?? [] }
              : tool.status === 'error'
                ? { kind: 'web', status: 'error', query }
                : { kind: 'web', status: 'loading', query };
        }
        const callId = tool.callId;
        set((s) => {
          const parts = [...s.parts];
          const idx = parts.findIndex((p) => p.type === 'tool' && p.callId === callId);
          if (idx >= 0) {
            parts[idx] = { type: 'tool', callId, state };
          } else {
            parts.push({ type: 'tool', callId, state });
          }
          return { parts };
        });
      },

      onDone: (fullContent, assistantMessageId, fullThinking, fullTool, chatTitle, usage) => {
        appendMessage({
          id: assistantMessageId,
          chatId,
          role: 'assistant',
          content: fullContent,
          thinking: fullThinking ?? null,
          toolData: fullTool ?? null,
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          createdAt: new Date().toISOString(),
        });
        if (chatTitle) patchChatTitle(chatId, chatTitle);
        set({ streaming: false, ...INITIAL });
      },

      onError: (code, message) => {
        set({ streaming: false, ...INITIAL, error: { code, message } });
      },
    });

    abortController = null;
  },
}));
