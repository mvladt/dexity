import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { EmptyContainer } from '@gravity-ui/aikit';
import type { Suggestion, TSubmitData } from '@gravity-ui/aikit';
import { useChatStore } from '../stores/chatStore';
import { useStreamStore } from '../stores/streamStore';
import { ChatStream } from '../components/ChatStream';
import { ChatComposer } from '../components/ChatComposer';

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
        <ChatComposer onSend={handleNewMessage} />
      </div>
    </div>
  );
}
