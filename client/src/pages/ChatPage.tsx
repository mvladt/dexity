import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Disclaimer, EmptyContainer, PromptInput } from '@gravity-ui/aikit';
import type { Suggestion, TSubmitData } from '@gravity-ui/aikit';
import { Select } from '@gravity-ui/uikit';
import { useChatStore } from '../stores/chatStore';
import { useStreamStore } from '../stores/streamStore';
import { useSettingsStore } from '../stores/settingsStore';
import { MODELS } from '../models';
import { ChatStream } from '../components/ChatStream';

const SUGGESTIONS: Suggestion[] = [
  { title: 'Объясни концепцию простыми словами', id: '1' },
  { title: 'Напиши краткое эссе на тему', id: '2' },
  { title: 'Помоги с кодом', id: '3' },
  { title: 'Переведи текст', id: '4' },
];

export function ChatPage() {
  const { chatId: chatIdParam } = useParams<{ chatId?: string }>();
  const navigate = useNavigate();
  const { chats, activeChat, fetchChats, setActive, fetchMessages, createChat, appendMessage } =
    useChatStore();
  const startStream = useStreamStore((s) => s.startStream);
  const model = useSettingsStore((s) => s.model);
  const setModel = useSettingsStore((s) => s.setModel);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    if (!chatIdParam) {
      setActive(null);
      return;
    }
    const id = parseInt(chatIdParam, 10);
    if (isNaN(id)) {
      navigate('/', { replace: true });
      return;
    }
    const chat = chats.find((c) => c.id === id);
    if (chat) {
      setActive(chat);
      fetchMessages(id).catch(() => navigate('/', { replace: true }));
    } else if (chats.length > 0) {
      navigate('/', { replace: true });
    }
  }, [chatIdParam, chats, navigate, setActive, fetchMessages]);

  const handleUserMessage = (content: string) => {
    if (!activeChat) return;
    appendMessage({
      id: Date.now(),
      chatId: activeChat.id,
      role: 'user' as const,
      content,
      createdAt: new Date().toISOString(),
    });
  };

  const handleSuggestion = async (content: string) => {
    const chat = await createChat();
    navigate(`/chat/${chat.id}`);
    setTimeout(() => {
      appendMessage({
        id: Date.now(),
        chatId: chat.id,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      });
      startStream(chat.id, content);
    }, 100);
  };

  const handleNewMessage = async (data: TSubmitData) => {
    if (!data.content.trim()) return;
    await handleSuggestion(data.content);
  };

  if (activeChat) {
    return <ChatStream chatId={activeChat.id} onUserMessage={handleUserMessage} />;
  }

  return (
    <div className="chat-content">
      <div className="chat-empty">
        <EmptyContainer
          title="Чем могу помочь?"
          suggestions={SUGGESTIONS}
          onSuggestionClick={handleSuggestion}
          layout="grid"
        />
      </div>
      <div className="chat-input">
        <PromptInput
          onSend={handleNewMessage}
          bodyProps={{ placeholder: 'Напишите сообщение…' }}
          view="simple"
        />
        <div className="chat-input-footer">
          <Select
            size="s"
            value={[model]}
            onUpdate={(vals) => setModel(vals[0])}
            options={MODELS.map((m) => ({ value: m.id, content: m.label }))}
          />
          <Disclaimer text="AI может ошибаться, проверяйте важное." />
          <span />
        </div>
      </div>
    </div>
  );
}
