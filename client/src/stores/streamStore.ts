import { create } from 'zustand';
import type { SSEEvent } from '../types';
import { streamMessages } from '../services/stream';
import { useChatStore } from './chatStore';

interface StreamStore {
  streaming: boolean;
  partialContent: string;
  error: { code: 'auth' | 'quota' | 'server'; message: string } | null;
  startStream: (chatId: number, content: string) => Promise<void>;
  clearError: () => void;
}

export const useStreamStore = create<StreamStore>()((set) => ({
  streaming: false,
  partialContent: '',
  error: null,

  clearError: () => set({ error: null }),

  startStream: async (chatId, content) => {
    set({ streaming: true, partialContent: '', error: null });
    const { appendMessage, patchChatTitle } = useChatStore.getState();

    await streamMessages(chatId, content, {
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
        set({ streaming: false, partialContent: '' });
      },

      onError: (code, message) => {
        set({ streaming: false, partialContent: '', error: { code, message } });
      },
    });
  },
}));
