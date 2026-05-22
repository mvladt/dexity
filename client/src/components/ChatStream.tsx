import { MessageList, createMessageRendererRegistry, registerMessageRenderer } from '@gravity-ui/aikit';
import type { TAssistantMessage, TChatMessage, TSubmitData, TMessageContent } from '@gravity-ui/aikit';
import { useChatStore } from '../stores/chatStore';
import { useStreamStore } from '../stores/streamStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getModel } from '../models';
import type { Message, Source } from '../types';
import { injectCitationLinks } from '../utils/citations';
import { ChatComposer } from './ChatComposer';
import { SourcesBlock } from './SourcesBlock';

// Custom content type for sources block
export type SourcesMessageContent = TMessageContent<
  'sources',
  { sources: Source[]; messageId: string }
>;

const messageRendererRegistry = createMessageRendererRegistry();
registerMessageRenderer<SourcesMessageContent>(messageRendererRegistry, 'sources', {
  component: ({ part }) => (
    <SourcesBlock messageId={part.data.messageId} sources={part.data.sources} />
  ),
});

function toAikitMessage(
  msg: Message,
  partialSources?: Source[],
): TChatMessage<SourcesMessageContent> {
  const isStreaming = msg.id === -1;
  const messageId = isStreaming ? 'streaming' : String(msg.id);

  if (msg.role === 'assistant') {
    const sources = isStreaming ? (partialSources ?? []) : (msg.sources ?? []);
    const text = sources.length > 0
      ? injectCitationLinks(msg.content, messageId, sources.length)
      : msg.content;

    if (sources.length > 0) {
      return {
        role: 'assistant',
        id: messageId,
        timestamp: msg.createdAt,
        content: [
          { type: 'text', data: { text } },
          { type: 'sources', data: { sources, messageId } },
        ],
      };
    }

    return {
      role: 'assistant',
      content: text,
      id: messageId,
      timestamp: msg.createdAt,
    };
  }

  return {
    role: 'user',
    content: msg.content,
    id: messageId,
    timestamp: msg.createdAt,
  };
}

const assistantActions = [
  {
    type: 'copy',
    onClick: (msg: TAssistantMessage<SourcesMessageContent>) => {
      const content = msg.content;
      if (typeof content === 'string') {
        navigator.clipboard.writeText(content);
      } else if (Array.isArray(content)) {
        const textPart = content.find((p) => p.type === 'text');
        if (textPart && 'data' in textPart && 'text' in (textPart.data as Record<string, unknown>)) {
          navigator.clipboard.writeText((textPart.data as { text: string }).text);
        }
      }
    },
  },
];

// Backend sends only last 20 messages to LLM
const HISTORY_WINDOW = 20;

// Rough token estimate: Cyrillic YandexGPT BPE ~1 token per 2-3 chars
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
  const partialSources = useStreamStore((s) => s.partialSources);
  const startStream = useStreamStore((s) => s.startStream);
  const cancel = useStreamStore((s) => s.cancel);
  const error = useStreamStore((s) => s.error);
  const model = useSettingsStore((s) => s.model);

  const streamingMsg: Message | null = streaming
    ? {
        id: -1,
        chatId,
        role: 'assistant',
        content: partialContent,
        createdAt: new Date().toISOString(),
      }
    : null;

  const displayMessages: TChatMessage<SourcesMessageContent>[] = [
    ...messages.map((m) => toAikitMessage(m)),
    ...(streamingMsg ? [toAikitMessage(streamingMsg, partialSources)] : []),
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
        <MessageList<SourcesMessageContent>
          messages={displayMessages}
          status={streaming ? 'streaming' : 'ready'}
          shouldParseIncompleteMarkdown={streaming}
          messageRendererRegistry={messageRendererRegistry}
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
