import { create } from 'zustand';
import { streamMessages } from '../services/stream';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';

interface StreamStore {
  streaming: boolean;
  partialContent: string;
  partialThinking: string;
  error: { code: 'auth' | 'quota' | 'server'; message: string } | null;
  startStream: (chatId: number, content: string) => Promise<void>;
  cancel: () => void;
  clearError: () => void;
}

let abortController: AbortController | null = null;

export const useStreamStore = create<StreamStore>()((set) => ({
  streaming: false,
  partialContent: '',
  partialThinking: '',
  error: null,

  clearError: () => set({ error: null }),

  cancel: () => {
    abortController?.abort();
    abortController = null;
    set({ streaming: false, partialContent: '', partialThinking: '' });
  },

  startStream: async (chatId, content) => {
    abortController = new AbortController();
    set({ streaming: true, partialContent: '', partialThinking: '', error: null });
    const { appendMessage, patchChatTitle } = useChatStore.getState();

    const { model, systemPrompt } = useSettingsStore.getState();

    await streamMessages(chatId, content, {
      signal: abortController.signal,
      model,
      systemPrompt: systemPrompt || undefined,

      onThinkingDelta: (delta) =>
        set((s) => ({ partialThinking: s.partialThinking + delta })),

      onDelta: (delta) => set((s) => ({ partialContent: s.partialContent + delta })),

      onDone: (fullContent, assistantMessageId, chatTitle) => {
        appendMessage({
          id: assistantMessageId,
          chatId,
          role: 'assistant',
          content: fullContent,
          createdAt: new Date().toISOString(),
        });
        if (chatTitle) patchChatTitle(chatId, chatTitle);
        set({ streaming: false, partialContent: '', partialThinking: '' });
      },

      onError: (code, message) => {
        set({
          streaming: false,
          partialContent: '',
          partialThinking: '',
          error: { code, message },
        });
      },
    });

    abortController = null;
  },
}));
