import { ContextIndicator, Disclaimer, PromptInput } from '@gravity-ui/aikit';
import type { TSubmitData } from '@gravity-ui/aikit';
import type { ChatStatus } from '@gravity-ui/aikit';
import { Select } from '@gravity-ui/uikit';
import { useSettingsStore } from '../stores/settingsStore';
import { MODELS } from '../models';

interface Props {
  onSend: (data: TSubmitData) => Promise<void>;
  onCancel?: () => Promise<void>;
  status?: ChatStatus;
  usedTokens?: number;
  maxContext?: number;
  placeholder?: string;
}

export function ChatComposer({ onSend, onCancel, status, usedTokens, maxContext, placeholder }: Props) {
  const model = useSettingsStore((s) => s.model);
  const setModel = useSettingsStore((s) => s.setModel);

  const showContextIndicator = usedTokens !== undefined && maxContext !== undefined;

  const bottomContent = (
    <div className="chat-composer-footer">
      <Select
        size="s"
        value={[model]}
        onUpdate={(vals) => setModel(vals[0])}
        options={MODELS.map((m) => ({ value: m.id, content: m.label }))}
        disabled={status === 'streaming'}
      />
      <Disclaimer className="chat-composer-disclaimer" text="AI может ошибаться, проверяйте важное." />
    </div>
  );

  return (
    <PromptInput
      view="full"
      onSend={onSend}
      onCancel={onCancel}
      status={status}
      bodyProps={{ placeholder: placeholder ?? 'Напишите сообщение…' }}
      headerProps={
        showContextIndicator
          ? {
              topContent: (
                <ContextIndicator
                  type="number"
                  usedContext={usedTokens}
                  maxContext={maxContext}
                  tooltipContent={`Использовано ~${usedTokens} из ${maxContext} токенов (оценка по последним 20 сообщениям)`}
                />
              ),
            }
          : undefined
      }
      footerProps={{ bottomContent }}
    />
  );
}
