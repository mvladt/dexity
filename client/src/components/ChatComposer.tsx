import { ContextIndicator, PromptInput } from '@gravity-ui/aikit';
import type { TSubmitData } from '@gravity-ui/aikit';
import type { ChatStatus } from '@gravity-ui/aikit';
import { Select, Text } from '@gravity-ui/uikit';
import { useSettingsStore } from '../stores/settingsStore';
import { MODELS } from '../models';

interface Props {
  onSend: (data: TSubmitData) => Promise<void>;
  onCancel?: () => Promise<void>;
  status?: ChatStatus;
  usedTokens?: number;
  maxContext?: number;
  totalUsage?: { prompt: number; completion: number };
  placeholder?: string;
  autoFocus?: boolean;
}

export function ChatComposer({ onSend, onCancel, status, usedTokens, maxContext, totalUsage, placeholder, autoFocus }: Props) {
  const model = useSettingsStore((s) => s.model);
  const setModel = useSettingsStore((s) => s.setModel);

  const showContextIndicator = usedTokens !== undefined && maxContext !== undefined;
  const showTotalUsage = totalUsage !== undefined && totalUsage.prompt + totalUsage.completion > 0;

  const bottomContent = (
    <div className="chat-composer-footer">
      <Select
        size="s"
        value={[model]}
        onUpdate={(vals) => setModel(vals[0])}
        options={MODELS.map((m) => ({ value: m.id, content: m.label }))}
        disabled={status === 'streaming'}
      />
    </div>
  );

  return (
    <PromptInput
      view="full"
      onSend={onSend}
      onCancel={onCancel}
      status={status}
      bodyProps={{ placeholder: placeholder ?? 'Напишите сообщение…', autoFocus }}
      headerProps={
        showContextIndicator || showTotalUsage
          ? {
              topContent: (
                <div className="chat-composer-stats">
                  {showContextIndicator && (
                    <ContextIndicator
                      type="number"
                      usedContext={usedTokens}
                      maxContext={maxContext}
                      tooltipContent={`Использовано ~${usedTokens} из ${maxContext} токенов (оценка по последним 20 сообщениям)`}
                    />
                  )}
                  {showTotalUsage && (
                    <Text className="dx-tokens" color="secondary">
                      ↑{totalUsage.prompt} ↓{totalUsage.completion}
                    </Text>
                  )}
                </div>
              ),
            }
          : undefined
      }
      footerProps={{ bottomContent }}
    />
  );
}
