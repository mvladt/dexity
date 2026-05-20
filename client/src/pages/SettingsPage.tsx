import { useEffect, useRef, useState } from 'react';
import { Text, TextArea } from '@gravity-ui/uikit';
import { useSettingsStore } from '../stores/settingsStore';

export function SettingsPage() {
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt);

  const [value, setValue] = useState(systemPrompt);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(systemPrompt);
  }, [systemPrompt]);

  const handleChange = (v: string) => {
    setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSystemPrompt(v);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
    }, 500);
  };

  return (
    <div className="settings-page">
      <Text variant="header-1">Настройки</Text>

      <div className="settings-section">
        <div className="settings-section-header">
          <Text variant="subheader-2">Системный промпт</Text>
          {saved && (
            <Text variant="body-1" color="positive" className="settings-saved">
              Сохранено
            </Text>
          )}
        </div>
        <Text variant="body-1" color="secondary">
          Применяется ко всем чатам, включая существующие.
        </Text>
        <TextArea
          value={value}
          onUpdate={handleChange}
          rows={8}
          placeholder="Например: ты опытный senior-разработчик, отвечай кратко…"
        />
      </div>
    </div>
  );
}
