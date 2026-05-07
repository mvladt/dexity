import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeStore {
  theme: 'light' | 'dark' | 'system';
  setTheme: (t: 'light' | 'dark' | 'system') => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'theme' },
  ),
);
