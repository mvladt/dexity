import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MODEL_ID, MODELS } from '../models';

interface SettingsStore {
  model: string;
  setModel: (id: string) => void;
  systemPrompt: string;
  setSystemPrompt: (s: string) => void;
  webSearch: boolean;
  setWebSearch: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      model: DEFAULT_MODEL_ID,
      setModel: (model) => set({ model }),
      systemPrompt: '',
      setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
      webSearch: false,
      setWebSearch: (webSearch) => set({ webSearch }),
    }),
    {
      name: 'dexity-settings',
      onRehydrateStorage: () => (state) => {
        if (state && !MODELS.some((m) => m.id === state.model)) {
          state.model = DEFAULT_MODEL_ID;
        }
      },
    },
  ),
);
