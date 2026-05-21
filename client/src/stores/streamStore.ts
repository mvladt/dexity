import { create } from 'zustand';
import type { Source } from '../types';
import { streamMessages } from '../services/stream';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';

interface StreamStore {
  streaming: boolean;
  partialContent: string;
  partialSources: Source[];
  error: { code: 'auth' | 'quota' | 'server'; message: string } | null;
  startStream: (chatId: number, content: string) => Promise<void>;
  cancel: () => void;
  clearError: () => void;
}

let abortController: AbortController | null = null;

export const useStreamStore = create<StreamStore>()((set, get) => ({
  streaming: false,
  partialContent: '',
  partialSources: [],
  error: null,

  clearError: () => set({ error: null }),

  cancel: () => {
    abortController?.abort();
    abortController = null;
    set({ streaming: false, partialContent: '', partialSources: [] });
  },

  startStream: async (chatId, content) => {
    abortController = new AbortController();
    set({ streaming: true, partialContent: '', partialSources: [], error: null });
    const { appendMessage, patchChatTitle } = useChatStore.getState();

    const { model, systemPrompt, webSearch } = useSettingsStore.getState();

    await streamMessages(chatId, content, {
      signal: abortController.signal,
      model,
      systemPrompt: systemPrompt || undefined,
      webSearch: webSearch || undefined,

      onDelta: (delta) => set((s) => ({ partialContent: s.partialContent + delta })),

      onSources: (sources) => set({ partialSources: sources }),

      onDone: (fullContent, assistantMessageId, chatTitle) => {
        const { partialSources } = get();
        appendMessage({
          id: assistantMessageId,
          chatId,
          role: 'assistant',
          content: fullContent,
          createdAt: new Date().toISOString(),
          ...(partialSources.length > 0 ? { sources: partialSources } : {}),
        });
        if (chatTitle) patchChatTitle(chatId, chatTitle);
        set({ streaming: false, partialContent: '', partialSources: [] });
      },

      onError: (code, message) => {
        set({ streaming: false, partialContent: '', partialSources: [], error: { code, message } });
      },
    });

    abortController = null;
  },
}));
