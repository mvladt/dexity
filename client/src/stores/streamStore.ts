import { create } from 'zustand';
import { streamMessages } from '../services/stream';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';
import type { Source } from '../types';

export type ToolState =
  | { status: 'loading' }
  | { status: 'success'; sources: Source[] }
  | { status: 'error' };

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

export const useStreamStore = create<StreamStore>()((set) => ({
  streaming: false,
  ...INITIAL,
  error: null,

  clearError: () => set({ error: null }),

  cancel: () => {
    abortController?.abort();
    abortController = null;
    set({ streaming: false, ...INITIAL });
  },

  startStream: async (chatId, content) => {
    abortController = new AbortController();
    set({ streaming: true, ...INITIAL, error: null });
    const { appendMessage, patchChatTitle } = useChatStore.getState();

    const { model, systemPrompt, webSearch } = useSettingsStore.getState();

    await streamMessages(chatId, content, {
      signal: abortController.signal,
      model,
      systemPrompt: systemPrompt || undefined,
      webSearch,

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

      onTool: (status, sources, callId) => {
        const state: ToolState =
          status === 'success'
            ? { status: 'success', sources: sources ?? [] }
            : status === 'error'
              ? { status: 'error' }
              : { status: 'loading' };
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

      onDone: (fullContent, assistantMessageId, fullThinking, fullTool, chatTitle) => {
        appendMessage({
          id: assistantMessageId,
          chatId,
          role: 'assistant',
          content: fullContent,
          thinking: fullThinking ?? null,
          toolData: fullTool ?? null,
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
