import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Text } from '@gravity-ui/uikit';
import { HistoryList } from '@gravity-ui/aikit';
import type { ChatType } from '@gravity-ui/aikit';
import { useChatStore } from '../stores/chatStore';

function toAikitChat(chat: { id: number; title: string; createdAt: string }): ChatType {
  return { id: String(chat.id), name: chat.title, createTime: chat.createdAt };
}

export function HistoryPage() {
  const { chats, activeChat, fetchChats, createChat, deleteChat } = useChatStore();
  const navigate = useNavigate();

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  const handleSelect = (aChat: ChatType) => {
    navigate(`/chat/${aChat.id}`);
  };

  const handleDelete = async (aChat: ChatType) => {
    const found = chats.find((c) => String(c.id) === aChat.id);
    if (found) await deleteChat(found.id);
  };

  const handleNewChat = async () => {
    const chat = await createChat();
    navigate(`/chat/${chat.id}`);
  };

  return (
    <div className="history-page">
      <div className="history-header">
        <Text variant="header-1">История</Text>
        <Button view="action" size="s" onClick={handleNewChat}>
          + Новый чат
        </Button>
      </div>

      <div className="history-list">
        <HistoryList
          chats={chats.map(toAikitChat)}
          selectedChat={activeChat ? toAikitChat(activeChat) : null}
          onSelectChat={handleSelect}
          onDeleteChat={handleDelete}
          showActions
          searchable
          groupBy="date"
        />
      </div>
    </div>
  );
}
