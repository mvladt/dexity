import { Switch } from '@gravity-ui/uikit';
import { useThemeStore } from '../stores/themeStore';

export function ThemeSwitcher() {
  const { theme, setTheme } = useThemeStore();
  const isDark = theme === 'dark';

  return (
    <Switch
      checked={isDark}
      onUpdate={(checked) => setTheme(checked ? 'dark' : 'light')}
      content={isDark ? 'Тёмная' : 'Светлая'}
    />
  );
}
