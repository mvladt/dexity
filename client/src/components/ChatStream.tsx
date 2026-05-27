import { useEffect, useState } from 'react';
import { MessageList, useSmartScroll } from '@gravity-ui/aikit';
import type {
  TAssistantMessage,
  TAssistantMessageContent,
  TChatMessage,
  TSubmitData,
} from '@gravity-ui/aikit';
import { Globe } from '@gravity-ui/icons';
import { Icon } from '@gravity-ui/uikit';
import { useChatStore } from '../stores/chatStore';
import { useStreamStore, type ToolState } from '../stores/streamStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getModel } from '../models';
import type { Message, Source } from '../types';
import { ChatComposer } from './ChatComposer';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function SourcesList({ sources }: { sources: Source[] }) {
  return (
    <ul className="dx-sources-list">
      {sources.map((s) => {
        const host = hostOf(s.url);
        return (
          <li key={s.position}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              <img
                src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                alt=""
                width={16}
                height={16}
              />
              <span className="dx-sources-list__host">{host}</span>
              <span className="dx-sources-list__title">{s.title}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function buildToolPart(tool: ToolState) {
  const base = {
    toolName: 'Web Search',
    toolIcon: <Icon data={Globe} size={16} />,
  };
  if (tool.status === 'loading') {
    return {
      type: 'tool' as const,
      data: { ...base, status: 'loading' as const, headerContent: 'Yandex Search…' },
    };
  }
  if (tool.status === 'error') {
    return {
      type: 'tool' as const,
      data: {
        ...base,
        status: 'error' as const,
        headerContent: 'Поиск не сработал',
      },
    };
  }
  // success
  return {
    type: 'tool' as const,
    data: {
      ...base,
      status: 'success' as const,
      headerContent:
        tool.sources.length > 0
          ? `${tool.sources.length} источников`
          : 'Источники не найдены',
      bodyContent: tool.sources.length > 0 ? <SourcesList sources={tool.sources} /> : null,
      autoCollapseOnSuccess: true,
    },
  };
}

function toAikitMessage(msg: Message): TChatMessage {
  // Assistant с сохранёнными thinking / sources — собираем массив партов.
  // Порядок: thinking → tool → text (thinking предшествует tool_call'у).
  if (msg.role === 'assistant' && (msg.thinking || msg.toolData?.sources?.length)) {
    const parts: TAssistantMessageContent = [];
    if (msg.thinking) {
      parts.push({
        type: 'thinking',
        data: {
          content: msg.thinking,
          status: 'thought',
          defaultExpanded: false,
          enabledCopy: true,
        },
      });
    }
    if (msg.toolData?.sources?.length) {
      parts.push(buildToolPart({ status: 'success', sources: msg.toolData.sources }));
    }
    parts.push({ type: 'text', data: { text: msg.content } });
    return {
      role: 'assistant',
      id: String(msg.id),
      timestamp: msg.createdAt,
      content: parts,
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
  const partialTools = useStreamStore((s) => s.partialTools);
  const startStream = useStreamStore((s) => s.startStream);
  const cancel = useStreamStore((s) => s.cancel);
  const error = useStreamStore((s) => s.error);
  const model = useSettingsStore((s) => s.model);

  // Порядок партов во время стриминга: thinking → tool0, tool1, … → text.
  // Thinking семантически предшествует tool_call'у (модель сначала решает,
  // что нужен поиск, потом зовёт его).
  const streamingParts: TAssistantMessageContent = [];
  if (partialThinking) {
    streamingParts.push({
      type: 'thinking',
      data: {
        content: partialThinking,
        status: partialContent ? 'thought' : 'thinking',
        defaultExpanded: true,
      },
    });
  }
  for (const tool of partialTools) {
    if (tool) streamingParts.push(buildToolPart(tool));
  }
  if (partialContent) {
    streamingParts.push({ type: 'text', data: { text: partialContent } });
  }

  // Пока стрим запущен, но ни одного парта ещё нет — не показываем пустой
  // assistant-пузырь. Вместо него aikit нарисует Loader (status='submitted').
  const displayMessages: TChatMessage[] = [
    ...messages.map(toAikitMessage),
    ...(streaming && streamingParts.length > 0
      ? [
          {
            role: 'assistant' as const,
            content: streamingParts,
            id: '__streaming__',
          },
        ]
      : []),
  ];

  // Debounce лоадера: показываем 'submitted' только если стрим висит без
  // контента дольше LOADER_DELAY_MS. Yandex часто отвечает за <500 мс, и
  // без задержки лоадер мелькал бы на долю секунды.
  const isWaitingFirstToken = streaming && streamingParts.length === 0;
  const [showSubmittedLoader, setShowSubmittedLoader] = useState(false);
  useEffect(() => {
    if (!isWaitingFirstToken) {
      setShowSubmittedLoader(false);
      return;
    }
    const t = setTimeout(() => setShowSubmittedLoader(true), 300);
    return () => clearTimeout(t);
  }, [isWaitingFirstToken]);

  const chatStatus = streaming
    ? streamingParts.length > 0
      ? 'streaming'
      : showSubmittedLoader
        ? 'submitted'
        : 'ready'
    : 'ready';

  const maxContext = getModel(model).maxContext;
  const usedTokens = messages
    .slice(-HISTORY_WINDOW)
    .reduce((sum, m) => sum + estimateTokens(m.content), 0);

  const handleSend = async (data: TSubmitData) => {
    if (!data.content.trim() || streaming) return;
    onUserMessage(data.content);
    await startStream(chatId, data.content);
  };

  const { containerRef } = useSmartScroll<HTMLDivElement>({
    isStreaming: streaming,
    messagesCount: messages.length,
    status: chatStatus,
  });

  return (
    <div className="chat-content">
      <div className="chat-messages" ref={containerRef}>
        <MessageList
          messages={displayMessages}
          status={chatStatus}
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
