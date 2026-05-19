import { Disclaimer, MessageList, PromptInput } from '@gravity-ui/aikit';
import type { TAssistantMessage, TChatMessage, TSubmitData } from '@gravity-ui/aikit';
import { useChatStore } from '../stores/chatStore';
import { useStreamStore } from '../stores/streamStore';
import type { Message } from '../types';

function toAikitMessage(msg: Message): TChatMessage {
  return {
    role: msg.role,
    content: msg.content,
    id: String(msg.id),
    timestamp: msg.createdAt,
  };
}

const assistantActions = [
  {
    type: 'copy',
    onClick: (msg: TAssistantMessage) => {
      if (typeof msg.content === 'string') navigator.clipboard.writeText(msg.content);
    },
  },
];

// Контекст модели. Дефолт совпадает с yandexgpt-lite/yandexgpt (~8K).
// Когда появится выбор модели (#12) — станет динамическим.
const MAX_CONTEXT_TOKENS = 8000;

// Бэк льёт в LLM только последние 20 сообщений.
const HISTORY_WINDOW = 20;

// Грубая оценка: для кириллицы YandexGPT BPE даёт ~1 токен на 2–3 символа.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

interface Props {
  chatId: number;
  onUserMessage: (content: string) => void;
}

export function ChatStream({ chatId, onUserMessage }: Props) {
  const messages = useChatStore((s) => s.messages);
  const streaming = useStreamStore((s) => s.streaming);
  const partialContent = useStreamStore((s) => s.partialContent);
  const startStream = useStreamStore((s) => s.startStream);
  const cancel = useStreamStore((s) => s.cancel);
  const error = useStreamStore((s) => s.error);

  const displayMessages: TChatMessage[] = [
    ...messages.map(toAikitMessage),
    ...(streaming
      ? [{ role: 'assistant' as const, content: partialContent, id: '__streaming__' }]
      : []),
  ];

  const usedTokens = messages
    .slice(-HISTORY_WINDOW)
    .reduce((sum, m) => sum + estimateTokens(m.content), 0);

  const handleSend = async (data: TSubmitData) => {
    if (!data.content.trim() || streaming) return;
    onUserMessage(data.content);
    await startStream(chatId, data.content);
  };

  return (
    <div className="chat-content">
      <div className="chat-messages">
        <MessageList
          messages={displayMessages}
          status={streaming ? 'streaming' : 'ready'}
          shouldParseIncompleteMarkdown={streaming}
          showTimestamp
          showActionsOnHover
          assistantActions={assistantActions}
          errorMessage={
            error ? { text: error.message, variant: 'error' as const } : undefined
          }
        />
      </div>
      <div className="chat-input">
        <PromptInput
          onSend={handleSend}
          onCancel={async () => cancel()}
          status={streaming ? 'streaming' : 'ready'}
          view="full"
          bodyProps={{ placeholder: 'Напишите сообщение…' }}
          headerProps={{
            showContextIndicator: true,
            contextIndicatorProps: {
              type: 'number',
              usedContext: usedTokens,
              maxContext: MAX_CONTEXT_TOKENS,
              tooltipContent: `Использовано ~${usedTokens} из ${MAX_CONTEXT_TOKENS} токенов (оценка по последним ${HISTORY_WINDOW} сообщениям)`,
            },
          }}
        />
        <Disclaimer text="AI может ошибаться, проверяйте важное." />
      </div>
    </div>
  );
}
