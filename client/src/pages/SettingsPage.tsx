import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Label,
  SegmentedRadioGroup,
  Select,
  Text,
  TextArea,
} from '@gravity-ui/uikit';
import {
  Check,
  Display,
  Key,
  Layers,
  Moon,
  Sparkles,
  Sun,
  TrashBin,
} from '@gravity-ui/icons';
import { useSettingsStore } from '../stores/settingsStore';
import { useThemeStore } from '../stores/themeStore';
import { MODELS } from '../models';

const SYSTEM_PROMPT_MAX = 4000;

const MODEL_ICONS: Record<string, React.ReactNode> = {
  'yandexgpt-lite': <Sparkles />,
  yandexgpt: <Sparkles />,
  'yandexgpt-32k': <Sparkles />,
};

export function SettingsPage() {
  const model = useSettingsStore((s) => s.model);
  const setModel = useSettingsStore((s) => s.setModel);
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt);

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // «Сохранено» badge в шапке — гасится через 1.5 с после любого изменения.
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markSaved = useCallback(() => {
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
  }, []);

  // Системный промпт — debounce 500 мс перед сохранением в store.
  const [draftPrompt, setDraftPrompt] = useState(systemPrompt);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setDraftPrompt(systemPrompt);
  }, [systemPrompt]);
  const handlePromptChange = (v: string) => {
    setDraftPrompt(v);
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
    promptTimerRef.current = setTimeout(() => {
      setSystemPrompt(v);
      markSaved();
    }, 500);
  };

  const handleModelChange = (vals: string[]) => {
    setModel(vals[0]);
    markSaved();
  };

  const handleTheme = (value: string) => {
    setTheme(value as 'light' | 'dark' | 'system');
    markSaved();
  };

  const handleDeleteAll = () => {
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      'Удалить все чаты, сообщения и источники? Действие необратимо.',
    );
    if (!ok) return;
    // Заглушка — бэк-эндпоинта нет. См. TODO.md.
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Text variant="header-1" as="h1">
          Настройки
        </Text>
        {saved && (
          <Label theme="success" size="m" icon={<Check />}>
            Сохранено
          </Label>
        )}
      </header>

      <div className="settings-inner">
        {/* ── Модель ─────────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__head">
            <Text variant="subheader-2" as="h2">
              Модель
            </Text>
            <Text variant="body-1" color="secondary">
              По умолчанию для новых чатов. Можно переопределить в композере конкретного чата.
            </Text>
          </div>

          <div className="settings-field">
            <Text variant="body-1" color="secondary" className="settings-field__label">
              Модель по умолчанию
            </Text>
            <Select
              size="m"
              value={[model]}
              onUpdate={handleModelChange}
              width="max"
            >
              {MODELS.map((m) => (
                <Select.Option key={m.id} value={m.id} content={m.label}>
                  <div className="settings-model-option">
                    <span className="settings-model-option__icon">
                      {MODEL_ICONS[m.id] ?? <Layers />}
                    </span>
                    <span>{m.label}</span>
                    <span className="settings-model-option__ctx">
                      · {Math.round(m.maxContext / 1000)}k
                    </span>
                  </div>
                </Select.Option>
              ))}
            </Select>
          </div>

          <div className="settings-field">
            <Text variant="body-1" color="secondary" className="settings-field__label">
              Системный промпт <span className="settings-field__sub">· применяется ко всем чатам</span>
            </Text>
            <TextArea
              value={draftPrompt}
              onUpdate={handlePromptChange}
              rows={5}
              maxRows={12}
              placeholder="Например: ты опытный senior-разработчик, отвечай кратко…"
            />
            <Text variant="caption-2" color="hint">
              Сохраняется автоматически · {draftPrompt.length} / {SYSTEM_PROMPT_MAX} символов
            </Text>
          </div>
        </section>

        {/* ── Интерфейс ──────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__head">
            <Text variant="subheader-2" as="h2">
              Интерфейс
            </Text>
          </div>

          <div className="settings-row">
            <div className="settings-row__info">
              <Text variant="body-2" className="settings-row__title">
                Тема оформления
              </Text>
              <Text variant="body-1" color="hint">
                Light, Dark или системная.
              </Text>
            </div>
            <SegmentedRadioGroup
              size="m"
              value={theme}
              onUpdate={handleTheme}
              options={[
                { value: 'light', content: <span className="settings-theme-opt"><Sun /> Light</span> },
                { value: 'dark', content: <span className="settings-theme-opt"><Moon /> Dark</span> },
                { value: 'system', content: <span className="settings-theme-opt"><Display /> Системная</span> },
              ]}
            />
          </div>
        </section>

        {/* ── Yandex Cloud ───────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__head">
            <Text variant="subheader-2" as="h2">
              Yandex Cloud
            </Text>
            <Text variant="body-1" color="secondary">
              Подключение к AI Studio. Ключи хранятся в <code className="settings-code">server/.env</code>.
            </Text>
          </div>

          <div className="settings-row">
            <div className="settings-row__info">
              <div className="settings-row__title-line">
                <Key className="settings-key-icon" />
                <Text variant="body-2" className="settings-row__title">
                  YC_API_KEY
                </Text>
                <Label theme="success" icon={<Check />}>
                  Активен
                </Label>
              </div>
              <Text variant="body-1" color="hint" className="settings-mono">
                AQVN••••••••••••••••••••••••CK4
              </Text>
            </div>
            <Button view="outlined" size="m" onClick={() => {}}>
              Изменить
            </Button>
          </div>

          <div className="settings-row">
            <div className="settings-row__info">
              <div className="settings-row__title-line">
                <Key className="settings-key-icon" />
                <Text variant="body-2" className="settings-row__title">
                  YC_SEARCH_API_KEY
                </Text>
                <Label theme="success" icon={<Check />}>
                  Активен
                </Label>
              </div>
              <Text variant="body-1" color="hint" className="settings-mono">
                AQVN••••••••••••••••••••••••2zG · для Web Search
              </Text>
            </div>
            <Button view="outlined" size="m" onClick={() => {}}>
              Изменить
            </Button>
          </div>

          <div className="settings-row">
            <div className="settings-row__info">
              <Text variant="body-2" className="settings-row__title">
                FOLDER_ID
              </Text>
              <Text variant="body-1" color="hint" className="settings-mono">
                b1g***********dxs
              </Text>
            </div>
            <Button view="outlined" size="m" onClick={() => {}}>
              Изменить
            </Button>
          </div>
        </section>

        {/* ── Опасная зона ──────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__head">
            <Text variant="subheader-2" as="h2" color="danger">
              Опасная зона
            </Text>
          </div>

          <div className="settings-row settings-row_danger">
            <div className="settings-row__info">
              <Text variant="body-2" className="settings-row__title">
                Удалить все чаты
              </Text>
              <Text variant="body-1" color="hint">
                Это действие необратимо. Удалятся все чаты, сообщения и источники.
              </Text>
            </div>
            <Button view="outlined-danger" size="m" onClick={handleDeleteAll}>
              <TrashBin />
              Удалить
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
