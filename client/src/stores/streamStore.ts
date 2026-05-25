import { create } from 'zustand';
import { streamMessages } from '../services/stream';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';
import type { Source } from '../types';

export type ToolState =
  | { status: 'loading' }
  | { status: 'success'; sources: Source[] }
  | { status: 'error' };

interface StreamStore {
  streaming: boolean;
  partialContent: string;
  partialThinking: string;
  partialTool: ToolState | null;
  error: { code: 'auth' | 'quota' | 'server'; message: string } | null;
  startStream: (chatId: number, content: string) => Promise<void>;
  cancel: () => void;
  clearError: () => void;
}

let abortController: AbortController | null = null;

const INITIAL = {
  partialContent: '',
  partialThinking: '',
  partialTool: null as ToolState | null,
};

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
        set((s) => ({ partialThinking: s.partialThinking + delta })),

      onDelta: (delta) => set((s) => ({ partialContent: s.partialContent + delta })),

      onTool: (status, sources) => {
        if (status === 'success') {
          set({ partialTool: { status: 'success', sources: sources ?? [] } });
        } else if (status === 'error') {
          set({ partialTool: { status: 'error' } });
        } else {
          set({ partialTool: { status: 'loading' } });
        }
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
