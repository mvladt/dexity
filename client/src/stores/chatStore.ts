import { create } from 'zustand';
import type { Chat, Message } from '../types';
import { api } from '../services/api';

interface ChatStore {
  chats: Chat[];
  activeChat: Chat | null;
  messages: Message[];
  fetchChats: () => Promise<void>;
  createChat: (title?: string) => Promise<Chat>;
  renameChat: (id: number, title: string) => Promise<void>;
  deleteChat: (id: number) => Promise<void>;
  setActive: (chat: Chat | null) => void;
  fetchMessages: (chatId: number) => Promise<void>;
  appendMessage: (msg: Message) => void;
  patchChatTitle: (id: number, title: string) => void;
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  chats: [],
  activeChat: null,
  messages: [],

  fetchChats: async () => {
    const chats = await api.get<Chat[]>('/api/chats');
    set({ chats });
  },

  createChat: async (title) => {
    const chat = await api.post<Chat>('/api/chats', title ? { title } : {});
    set((s) => ({ chats: [chat, ...s.chats] }));
    return chat;
  },

  renameChat: async (id, title) => {
    const updated = await api.patch<Chat>(`/api/chats/${id}`, { title });
    set((s) => ({
      chats: s.chats.map((c) => (c.id === id ? updated : c)),
      activeChat: s.activeChat?.id === id ? updated : s.activeChat,
    }));
  },

  deleteChat: async (id) => {
    await api.delete(`/api/chats/${id}`);
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== id),
      activeChat: s.activeChat?.id === id ? null : s.activeChat,
      messages: s.activeChat?.id === id ? [] : s.messages,
    }));
  },

  setActive: (chat) => set({ activeChat: chat, messages: [] }),

  fetchMessages: async (chatId) => {
    const messages = await api.get<Message[]>(`/api/chats/${chatId}/messages`);
    set({ messages });
  },

  appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  patchChatTitle: (id, title) => {
    set((s) => ({
      chats: s.chats.map((c) => (c.id === id ? { ...c, title } : c)),
      activeChat: s.activeChat?.id === id ? { ...s.activeChat, title } : s.activeChat,
    }));
    // Move chat to top (it was just updated)
    const { chats } = get();
    const chat = chats.find((c) => c.id === id);
    if (chat) {
      set((s) => ({ chats: [chat, ...s.chats.filter((c) => c.id !== id)] }));
    }
  },
}));
