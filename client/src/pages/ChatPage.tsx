import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { EmptyContainer, PromptInput } from '@gravity-ui/aikit';
import type { Suggestion, TSubmitData } from '@gravity-ui/aikit';
import { useChatStore } from '../stores/chatStore';
import { useStreamStore } from '../stores/streamStore';
import { ChatSidebar } from '../components/ChatSidebar';
import { ChatStream } from '../components/ChatStream';
import { ThemeSwitcher } from '../components/ThemeSwitcher';

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

  // Load chats on mount
  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  // Resolve active chat from URL
  useEffect(() => {
    if (!chatIdParam) {
      setActive(null);
      return;
    }
    const id = parseInt(chatIdParam, 10);
    if (isNaN(id)) {
      navigate('/chat', { replace: true });
      return;
    }
    const chat = chats.find((c) => c.id === id);
    if (chat) {
      setActive(chat);
      fetchMessages(id).catch(() => navigate('/chat', { replace: true }));
    } else if (chats.length > 0) {
      // chats loaded but chat not found
      navigate('/chat', { replace: true });
    }
  }, [chatIdParam, chats, navigate, setActive, fetchMessages]);

  const handleUserMessage = (content: string) => {
    if (!activeChat) return;
    const optimistic = {
      id: Date.now(),
      chatId: activeChat.id,
      role: 'user' as const,
      content,
      createdAt: new Date().toISOString(),
    };
    appendMessage(optimistic);
  };

  const handleSuggestion = async (content: string) => {
    const chat = await createChat();
    navigate(`/chat/${chat.id}`);
    // Small delay to let route update and fetchMessages run
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

  return (
    <div className="chat-layout">
      <ChatSidebar />

      <div className="chat-main">
        <div className="chat-main-header">
          <ThemeSwitcher />
        </div>

        {activeChat ? (
          <ChatStream
            chatId={activeChat.id}
            onUserMessage={handleUserMessage}
          />
        ) : (
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
