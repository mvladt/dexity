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
          view="simple"
          bodyProps={{ placeholder: 'Напишите сообщение…' }}
        />
        <Disclaimer text="AI может ошибаться, проверяйте важное." />
      </div>
    </div>
  );
}
