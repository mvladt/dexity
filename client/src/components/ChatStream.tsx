import { MessageList, PromptInput } from '@gravity-ui/aikit';
import type { TChatMessage, TSubmitData } from '@gravity-ui/aikit';
import { useChatStore } from '../stores/chatStore';
import { useStreamStore } from '../stores/streamStore';
import type { Message } from '../types';

function toAikitMessage(msg: Message): TChatMessage {
  return { role: msg.role, content: msg.content, id: String(msg.id) };
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
          errorMessage={
            error ? { text: error.message, variant: 'error' as const } : undefined
          }
        />
      </div>
      <div className="chat-input">
        <PromptInput
          onSend={handleSend}
          disabled={streaming}
          status={streaming ? 'streaming' : 'ready'}
          view="simple"
        />
      </div>
    </div>
  );
}
