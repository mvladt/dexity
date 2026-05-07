import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, TextInput, Text } from '@gravity-ui/uikit';
import { HistoryList } from '@gravity-ui/aikit';
import type { ChatType } from '@gravity-ui/aikit';
import { useChatStore } from '../stores/chatStore';
import type { Chat } from '../types';

function toAikitChat(chat: Chat): ChatType {
  return { id: String(chat.id), name: chat.title, createTime: chat.createdAt };
}

export function ChatSidebar() {
  const { chats, activeChat, createChat, deleteChat, renameChat } = useChatStore();
  const navigate = useNavigate();

  const [renameTarget, setRenameTarget] = useState<Chat | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleSelect = async (aChat: ChatType) => {
    const found = chats.find((c) => String(c.id) === aChat.id);
    if (found) navigate(`/chat/${found.id}`);
  };

  const handleDelete = async (aChat: ChatType) => {
    const found = chats.find((c) => String(c.id) === aChat.id);
    if (found) await deleteChat(found.id);
  };

  const handleNewChat = async () => {
    const chat = await createChat();
    navigate(`/chat/${chat.id}`);
  };

  const openRename = (chat: Chat) => {
    setRenameTarget(chat);
    setRenameValue(chat.title);
  };

  const confirmRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    await renameChat(renameTarget.id, renameValue.trim());
    setRenameTarget(null);
  };

  return (
    <div className="chat-sidebar">
      <div className="chat-sidebar-header">
        <Text variant="subheader-2">Dexity</Text>
        <Button view="action" size="s" onClick={handleNewChat}>
          + Новый
        </Button>
      </div>

      <div className="chat-sidebar-list">
        <HistoryList
          chats={chats.map(toAikitChat)}
          selectedChat={activeChat ? toAikitChat(activeChat) : null}
          onSelectChat={handleSelect}
          onDeleteChat={handleDelete}
          showActions
          groupBy="none"
        />
      </div>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onClose={() => setRenameTarget(null)}>
        <Dialog.Header caption="Переименовать чат" />
        <Dialog.Body>
          <TextInput
            value={renameValue}
            onUpdate={setRenameValue}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
          />
        </Dialog.Body>
        <Dialog.Footer
          onClickButtonApply={confirmRename}
          onClickButtonCancel={() => setRenameTarget(null)}
          textButtonApply="Сохранить"
          textButtonCancel="Отмена"
        />
      </Dialog>
    </div>
  );
}
