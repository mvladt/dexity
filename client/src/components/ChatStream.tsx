import { useEffect, useState } from 'react';
import { MessageList, useSmartScroll } from '@gravity-ui/aikit';
import type {
  BaseMessageAction,
  TAssistantMessage,
  TAssistantMessageContent,
  TChatMessage,
  TSubmitData,
} from '@gravity-ui/aikit';
import { Globe, Magnifier } from '@gravity-ui/icons';
import { Icon, Text } from '@gravity-ui/uikit';
import { useChatStore } from '../stores/chatStore';
import { useStreamStore, type StreamPart, type ToolState } from '../stores/streamStore';
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

type FetchToolState = Extract<ToolState, { kind: 'fetch' }>;
type WebToolState = Extract<ToolState, { kind: 'web' }>;

function buildFetchPart(tool: FetchToolState) {
  const base = {
    toolName: 'Fetch',
    toolIcon: <Icon data={Globe} size={16} />,
  };
  // Показываем домен (полный URL бывает длинным — captcha, query-параметры).
  // Домен всегда кликабелен и ведёт на точную страницу — на неудачном fetch это
  // даже нужнее: можно глазами проверить, что там не загрузилось. Статус рисует ToolMessage.
  const host = hostOf(tool.url);
  const link = (
    <a className="dx-fetch-link" href={tool.url} target="_blank" rel="noopener noreferrer">
      {host}
    </a>
  );
  if (tool.status !== 'success') {
    return { type: 'tool' as const, data: { ...base, status: tool.status, headerContent: link } };
  }
  // На success рядом с доменом — длина извлечённого текста. Короткое число =
  // сигнал мусора (капча/заглушка), даже под зелёной галочкой. Тело — сам текст,
  // ровно то, что ушло в LLM: можно развернуть и проверить, что прочитала модель.
  const content = tool.content ?? '';
  const len = content.length;
  const headerContent = (
    <span className="dx-fetch-header">
      {link}
      <span className="dx-fetch-len">· {len.toLocaleString('ru-RU')} симв.</span>
    </span>
  );
  return {
    type: 'tool' as const,
    data: {
      ...base,
      status: tool.status,
      headerContent,
      bodyContent: content ? <pre className="dx-fetch-content">{content}</pre> : null,
      autoCollapseOnSuccess: true,
    },
  };
}

function buildToolPart(tool: ToolState) {
  if (tool.kind === 'fetch') return buildFetchPart(tool);
  return buildWebPart(tool);
}

// Длинный запрос обрезаем — плашка не должна растягиваться на весь экран.
const QUERY_MAX_LEN = 64;
function truncateQuery(query: string): string {
  return query.length > QUERY_MAX_LEN ? `${query.slice(0, QUERY_MAX_LEN).trimEnd()}…` : query;
}

function buildWebPart(tool: WebToolState) {
  const base = {
    toolName: 'Search',
    toolIcon: <Icon data={Magnifier} size={16} />,
  };
  // Показываем сам запрос. Если его нет (legacy-история) — откатываемся к статусным текстам.
  const queryHeader = tool.query ? truncateQuery(tool.query) : null;
  if (tool.status === 'loading') {
    return {
      type: 'tool' as const,
      data: { ...base, status: 'loading' as const, headerContent: queryHeader ?? 'Yandex Search…' },
    };
  }
  if (tool.status === 'error') {
    return {
      type: 'tool' as const,
      data: {
        ...base,
        status: 'error' as const,
        headerContent: queryHeader ?? 'Поиск не сработал',
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
        queryHeader ??
        (tool.sources.length > 0 ? `${tool.sources.length} источников` : 'Источники не найдены'),
      bodyContent: tool.sources.length > 0 ? <SourcesList sources={tool.sources} /> : null,
      autoCollapseOnSuccess: true,
    },
  };
}

function buildThinkingPart(content: string, isLast: boolean) {
  return {
    type: 'thinking' as const,
    data: {
      content,
      status: isLast ? ('thinking' as const) : ('thought' as const),
      defaultExpanded: true,
      enabledCopy: true,
    },
  };
}

function partsToAikitContent(parts: StreamPart[]): TAssistantMessageContent {
  const result: TAssistantMessageContent = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === 'thinking') {
      result.push(buildThinkingPart(p.content, i === parts.length - 1));
    } else if (p.type === 'tool') {
      result.push(buildToolPart(p.state));
    } else {
      result.push({ type: 'text', data: { text: p.content } });
    }
  }
  return result;
}

function toAikitMessage(msg: Message): TChatMessage {
  const snapshot = msg.toolData?.parts;
  const hasTool = !!(
    msg.toolData?.calls?.length ||
    msg.toolData?.sources?.length ||
    msg.toolData?.parts?.some((p) => p.type === 'tool' || p.type === 'fetch')
  );
  if (msg.role === 'assistant' && (msg.thinking || hasTool)) {
    const parts: TAssistantMessageContent = [];
    if (snapshot?.length) {
      // Полная последовательность парт в порядке появления (thinking₁, tool₁, thinking₂, …).
      for (const p of snapshot) {
        if (p.type === 'thinking') parts.push(buildThinkingPart(p.content, false));
        else if (p.type === 'fetch')
          parts.push(
            buildFetchPart(
              p.error
                ? { kind: 'fetch', status: 'error', url: p.url }
                : { kind: 'fetch', status: 'success', url: p.url, title: p.title, content: p.content },
            ),
          );
        else parts.push(buildToolPart({ kind: 'web', status: 'success', query: p.query ?? '', sources: p.sources }));
      }
    } else {
      // Legacy без снапшота: один склеенный thinking + либо calls (новый), либо плоский sources.
      if (msg.thinking) parts.push(buildThinkingPart(msg.thinking, false));
      if (msg.toolData?.calls?.length) {
        for (const sources of msg.toolData.calls) {
          parts.push(buildToolPart({ kind: 'web', status: 'success', query: '', sources }));
        }
      } else if (msg.toolData?.sources?.length) {
        parts.push(buildToolPart({ kind: 'web', status: 'success', query: '', sources: msg.toolData.sources }));
      }
    }
    parts.push({ type: 'text', data: { text: msg.content } });
    return {
      role: 'assistant',
      id: String(msg.id),
      timestamp: msg.createdAt,
      content: parts,
      actions: buildAssistantActions(msg),
      metadata: { promptTokens: msg.promptTokens, completionTokens: msg.completionTokens },
    };
  }
  return {
    role: msg.role,
    content: msg.content,
    id: String(msg.id),
    timestamp: msg.createdAt,
    ...(msg.role === 'assistant'
      ? {
          actions: buildAssistantActions(msg),
          metadata: { promptTokens: msg.promptTokens, completionTokens: msg.completionTokens },
        }
      : {}),
  };
}

// Экшены ответа ассистента: только копирование. Токены идут отдельным слотом
// extraInfo (см. TokenInfo), чтобы CSS мог прижать их в правый угол футера.
function buildAssistantActions(msg: Message): BaseMessageAction[] {
  return [{ actionType: 'copy', onClick: () => navigator.clipboard.writeText(msg.content) }];
}

// Реальный расход токенов «↑prompt ↓completion» — рендерится в правом углу
// футера сообщения (через MessageList.assistantExtraInfo). Размер — gravity-токен
// (.dx-tokens). Нет данных (частичный ответ) — не рисуем.
function TokenInfo({ message }: { message: TAssistantMessage }) {
  const meta = message.metadata as
    | { promptTokens?: number | null; completionTokens?: number | null }
    | undefined;
  if (meta?.promptTokens == null || meta?.completionTokens == null) return null;
  return (
    <Text className="dx-tokens" color="secondary">
      ↑{meta.promptTokens} ↓{meta.completionTokens}
    </Text>
  );
}

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
  const parts = useStreamStore((s) => s.parts);
  const startStream = useStreamStore((s) => s.startStream);
  const cancel = useStreamStore((s) => s.cancel);
  const error = useStreamStore((s) => s.error);
  const model = useSettingsStore((s) => s.model);

  // Парты собираются в порядке поступления: thinking, потом tool, потом
  // снова thinking (если модель «думает» над результатом поиска), и так
  // далее, заканчивается text-партом с финальным ответом.
  const streamingParts = partsToAikitContent(parts);

  // Пока стрим запущен, но ни одного парта ещё нет — не показываем пустой
  // assistant-пузырь. Вместо него aikit нарисует Loader (status='submitted').
  const displayMessages: TChatMessage[] = [
    ...messages.map(toAikitMessage),
    ...(streaming && parts.length > 0
      ? [
          {
            role: 'assistant' as const,
            content: streamingParts,
            id: '__streaming__',
            // Валидный timestamp, иначе aikit (showTimestamp) рендерит
            // «Input date is invalid». Футер всё равно скрыт до hover.
            timestamp: new Date().toISOString(),
          },
        ]
      : []),
  ];

  // Debounce лоадера: показываем 'submitted' только если стрим висит без
  // контента дольше LOADER_DELAY_MS. Yandex часто отвечает за <500 мс, и
  // без задержки лоадер мелькал бы на долю секунды.
  const isWaitingFirstToken = streaming && parts.length === 0;
  const [showSubmittedLoader, setShowSubmittedLoader] = useState(false);
  useEffect(() => {
    if (!isWaitingFirstToken) {
      setShowSubmittedLoader(false);
      return;
    }
    const t = setTimeout(() => setShowSubmittedLoader(true), 300);
    return () => clearTimeout(t);
  }, [isWaitingFirstToken]);

  // MessageList рисует errorMessage только при status==='error' — иначе ошибка
  // стрима молча теряется (стрим обрывается, а в UI ни лоадера, ни текста).
  const chatStatus = error
    ? 'error'
    : streaming
      ? parts.length > 0
        ? 'streaming'
        : showSubmittedLoader
          ? 'submitted'
          : 'ready'
      : 'ready';

  const maxContext = getModel(model).maxContext;
  const usedTokens = messages
    .slice(-HISTORY_WINDOW)
    .reduce((sum, m) => sum + estimateTokens(m.content), 0);

  // Суммарный реальный расход по чату — сумма usage всех ответов ассистента.
  const totalUsage = messages.reduce(
    (acc, m) => ({
      prompt: acc.prompt + (m.promptTokens ?? 0),
      completion: acc.completion + (m.completionTokens ?? 0),
    }),
    { prompt: 0, completion: 0 },
  );

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
          showActionsOnHover
          showTimestamp
          assistantExtraInfo={TokenInfo}
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
          totalUsage={totalUsage}
        />
      </div>
    </div>
  );
}
