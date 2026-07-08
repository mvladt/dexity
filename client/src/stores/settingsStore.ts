import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MODEL_ID, MODELS } from '../models';

interface SettingsStore {
  model: string;
  setModel: (id: string) => void;
  systemPrompt: string;
  setSystemPrompt: (s: string) => void;
  collapseThinkingByDefault: boolean;
  setCollapseThinkingByDefault: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      model: DEFAULT_MODEL_ID,
      setModel: (model) => set({ model }),
      systemPrompt: '',
      setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
      collapseThinkingByDefault: true,
      setCollapseThinkingByDefault: (collapseThinkingByDefault) => set({ collapseThinkingByDefault }),
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
