import { MessageList } from '@gravity-ui/aikit';
import type {
  TAssistantMessage,
  TAssistantMessageContent,
  TChatMessage,
  TSubmitData,
} from '@gravity-ui/aikit';
import { useChatStore } from '../stores/chatStore';
import { useStreamStore } from '../stores/streamStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getModel } from '../models';
import type { Message } from '../types';
import { ChatComposer } from './ChatComposer';

function toAikitMessage(msg: Message): TChatMessage {
  // Assistant с сохранённым thinking → парты [{thinking, status:'thought'}, {text}]
  if (msg.role === 'assistant' && msg.thinking) {
    return {
      role: 'assistant',
      id: String(msg.id),
      timestamp: msg.createdAt,
      content: [
        {
          type: 'thinking',
          data: {
            content: msg.thinking,
            status: 'thought',
            defaultExpanded: false,
            enabledCopy: true,
          },
        },
        { type: 'text', data: { text: msg.content } },
      ],
    };
  }
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
  const partialThinking = useStreamStore((s) => s.partialThinking);
  const startStream = useStreamStore((s) => s.startStream);
  const cancel = useStreamStore((s) => s.cancel);
  const error = useStreamStore((s) => s.error);
  const model = useSettingsStore((s) => s.model);

  const streamingParts: TAssistantMessageContent = [];
  if (partialThinking) {
    streamingParts.push({
      type: 'thinking',
      data: {
        content: partialThinking,
        status: 'thinking',
        defaultExpanded: true,
      },
    });
  }
  if (partialContent) {
    streamingParts.push({ type: 'text', data: { text: partialContent } });
  }

  const displayMessages: TChatMessage[] = [
    ...messages.map(toAikitMessage),
    ...(streaming
      ? [
          {
            role: 'assistant' as const,
            content: streamingParts.length > 0 ? streamingParts : '',
            id: '__streaming__',
          },
        ]
      : []),
  ];

  const maxContext = getModel(model).maxContext;
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
        <ChatComposer
          onSend={handleSend}
          onCancel={async () => cancel()}
          status={streaming ? 'streaming' : 'ready'}
          usedTokens={usedTokens}
          maxContext={maxContext}
        />
      </div>
    </div>
  );
}
