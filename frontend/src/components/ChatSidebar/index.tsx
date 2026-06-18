import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CloseOutlined,
  SendOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { Empty, Spin, Avatar, Tooltip, Dropdown } from 'antd';
import dayjs from 'dayjs';
import { useCollabStore } from '@/store';
import type { ChatMessageData, PresenceData } from '@/types';

const SIDEBAR_WIDTH = 320;

const getInitial = (name: string) => {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
};

const getDicebearUrl = (seed: string) => {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
};

interface ChatSidebarProps {
  open: boolean;
  onClose: () => void;
}

interface MentionDropdownProps {
  users: PresenceData[];
  onSelect: (user: PresenceData) => void;
  children: React.ReactElement;
}

const MentionDropdown: React.FC<MentionDropdownProps> = ({ users, onSelect, children }) => {
  const items = users.length > 0
    ? users.map(user => ({
        key: user.user_id,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <Avatar
              size={24}
              src={getDicebearUrl(user.user_name)}
              style={{
                border: `2px solid ${user.user_color}`,
                background: '#fff',
              }}
            >
              {getInitial(user.user_name)}
            </Avatar>
            <span style={{ color: user.user_color, fontWeight: 500 }}>
              {user.user_name}
            </span>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#52c41a',
                marginLeft: 'auto',
              }}
            />
          </div>
        ),
      }))
    : [{ key: 'empty', label: <span style={{ color: '#999' }}>暂无在线用户</span>, disabled: true }];

  return (
    <Dropdown
      menu={{ items, onClick: ({ key }) => {
        const user = users.find(u => u.user_id === key);
        if (user) onSelect(user);
      }}}
      trigger={['click']}
      placement="topLeft"
    >
      {children}
    </Dropdown>
  );
};

interface MessageBubbleProps {
  message: ChatMessageData;
  isSelf: boolean;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isSelf }) => {
  const renderContentWithMentions = (content: string, mentions: string[]) => {
    if (!mentions || mentions.length === 0) {
      return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</span>;
    }

    const store = useCollabStore.getState();
    const users: { id: string; name: string }[] = [
      { id: store.currentUserId, name: store.currentUserName },
      ...Array.from(store.onlineUsers.values()).map(p => ({ id: p.user_id, name: p.user_name })),
    ];

    let result: (string | React.ReactNode)[] = [content];

    users.forEach(user => {
      if (!mentions.includes(user.id)) return;
      const mentionPattern = `@${user.name}`;
      const newResult: (string | React.ReactNode)[] = [];

      result.forEach(part => {
        if (typeof part !== 'string') {
          newResult.push(part);
          return;
        }

        let lastIndex = 0;
        let idx = part.indexOf(mentionPattern, lastIndex);

        while (idx !== -1) {
          if (idx > lastIndex) {
            newResult.push(part.slice(lastIndex, idx));
          }
          newResult.push(
            <span
              key={`mention-${user.id}-${idx}-${Math.random()}`}
              style={{
                color: '#1677ff',
                fontWeight: 700,
                background: 'rgba(22, 119, 255, 0.1)',
                padding: '0 2px',
                borderRadius: 2,
              }}
            >
              {mentionPattern}
            </span>
          );
          lastIndex = idx + mentionPattern.length;
          idx = part.indexOf(mentionPattern, lastIndex);
        }

        if (lastIndex < part.length) {
          newResult.push(part.slice(lastIndex));
        }
      });

      result = newResult;
    });

    return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result}</span>;
  };

  return (
    <div
      data-message-id={message.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isSelf ? 'flex-end' : 'flex-start',
        marginBottom: 12,
        padding: 4,
        borderRadius: 8,
        transition: 'background 0.3s ease',
      }}
      className="chat-message-item"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', flexDirection: isSelf ? 'row-reverse' : 'row' }}>
        <Avatar
          size={32}
          src={getDicebearUrl(message.user_name)}
          style={{
            border: `2px solid ${message.user_color}`,
            background: '#fff',
            flexShrink: 0,
          }}
        >
          {getInitial(message.user_name)}
        </Avatar>
        <div
          style={{
            maxWidth: 'calc(100% - 48px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: isSelf ? 'flex-end' : 'flex-start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ color: message.user_color, fontWeight: 600, fontSize: 13 }}>
              {message.user_name}
            </span>
            <Tooltip title={dayjs(message.timestamp).format('YYYY-MM-DD HH:mm:ss')}>
              <span style={{ color: '#999', fontSize: 11 }}>
                {dayjs(message.timestamp).format('HH:mm')}
              </span>
            </Tooltip>
          </div>
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 12,
              background: isSelf ? '#1677ff' : '#f0f0f0',
              color: isSelf ? '#fff' : '#333',
              fontSize: 14,
              lineHeight: 1.5,
              borderTopRightRadius: isSelf ? 2 : 12,
              borderTopLeftRadius: isSelf ? 12 : 2,
            }}
          >
            {renderContentWithMentions(message.content, message.mentions)}
          </div>
        </div>
      </div>
    </div>
  );
};

interface SystemMessageProps {
  message: ChatMessageData;
}

const SystemMessage: React.FC<SystemMessageProps> = ({ message }) => {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        margin: '12px 0',
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: '#999',
          background: '#f5f5f5',
          padding: '4px 12px',
          borderRadius: 10,
        }}
      >
        {message.content}
      </span>
    </div>
  );
};

const ChatSidebar: React.FC<ChatSidebarProps> = ({ open, onClose }) => {
  const {
    chatMessages,
    addChatMessage,
    sendChat,
    setChatHistory,
    onlineUsers,
    sidebarOpen,
    setSidebarOpen,
    triggerMentionFlash,
    mentionFlash,
    currentUserId,
    currentUserName,
    currentUserColor,
  } = useCollabStore();

  const [inputValue, setInputValue] = useState('');
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, scrollToBottom]);

  useEffect(() => {
    const demoMessages: ChatMessageData[] = [
      {
        id: 'msg_sys_1',
        channel_id: 'main',
        user_id: 'system',
        user_name: '系统',
        user_color: '#999',
        content: '欢迎加入协作房间',
        mentions: [],
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        is_system: true,
      },
    ];
    setChatHistory(demoMessages);

    const timer = setTimeout(() => {
      const demoUserMessage: ChatMessageData = {
        id: 'msg_demo_1',
        channel_id: 'main',
        user_id: 'user_demo_1',
        user_name: '协作助手',
        user_color: '#52c41a',
        content: `大家好！欢迎使用协作聊天功能。你可以输入消息并发送，使用 @按钮 来提及其他用户。`,
        mentions: [],
        timestamp: new Date(Date.now() - 1800000).toISOString(),
        is_system: false,
      };
      addChatMessage(demoUserMessage);
    }, 1000);

    return () => clearTimeout(timer);
  }, [setChatHistory, addChatMessage]);

  const allUsersForMention: PresenceData[] = [
    {
      user_id: currentUserId,
      user_name: currentUserName,
      user_color: currentUserColor,
      last_active: new Date().toISOString(),
    },
    ...Array.from(onlineUsers.values()),
  ];

  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content) return;

    sendChat(content);
    setInputValue('');
    setSelectedMentions([]);
    textareaRef.current?.focus();
  }, [inputValue, sendChat]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleMentionSelect = useCallback((user: PresenceData) => {
    const mentionText = `@${user.user_name} `;
    setInputValue(prev => prev + mentionText);
    setSelectedMentions(prev =>
      prev.includes(user.user_id) ? prev : [...prev, user.user_id]
    );
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const handleEffectiveClose = useCallback(() => {
    setSidebarOpen(false);
    onClose();
  }, [setSidebarOpen, onClose]);

  const effectiveOpen = open || sidebarOpen;

  if (!effectiveOpen) {
    return null;
  }

  return (
    <div
      style={{
        width: SIDEBAR_WIDTH,
        height: '100%',
        background: '#fff',
        borderLeft: '1px solid #e8e8e8',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        boxShadow: mentionFlash
          ? '0 0 0 3px rgba(22, 119, 255, 0.3), inset 0 0 20px rgba(22, 119, 255, 0.1)'
          : 'none',
        transition: 'box-shadow 0.3s ease',
        animation: mentionFlash ? 'mentionPulse 0.6s ease-in-out 3' : 'none',
      }}
    >
      <style>{`
        @keyframes mentionPulse {
          0%, 100% { box-shadow: inset 0 0 0 rgba(22, 119, 255, 0); }
          50% { box-shadow: inset 0 0 20px rgba(22, 119, 255, 0.3); }
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageOutlined style={{ color: '#1677ff', fontSize: 16 }} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>讨论</span>
          {onlineUsers.size > 0 && (
            <Tooltip title={`${onlineUsers.size}位用户在线`}>
              <span
                style={{
                  fontSize: 11,
                  color: '#52c41a',
                  background: 'rgba(82, 196, 26, 0.1)',
                  padding: '1px 6px',
                  borderRadius: 4,
                }}
              >
                {onlineUsers.size + 1} 在线
              </span>
            </Tooltip>
          )}
        </div>
        <Tooltip title="关闭讨论">
          <button
            onClick={handleEffectiveClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: 4,
              color: '#999',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#f5f5f5';
              e.currentTarget.style.color = '#333';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#999';
            }}
          >
            <CloseOutlined />
          </button>
        </Tooltip>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {chatMessages.length === 0 ? (
          <Empty
            style={{ margin: 'auto 0' }}
            description={
              <span style={{ color: '#999' }}>暂无讨论，发送第一条消息开始协作吧</span>
            }
          />
        ) : (
          chatMessages.map(msg =>
            msg.is_system ? (
              <SystemMessage key={msg.id} message={msg} />
            ) : (
              <MessageBubble
                key={msg.id}
                message={msg}
                isSelf={msg.user_id === currentUserId}
              />
            )
          )
        )}
        <div ref={messagesEndRef} />
      </div>

      <div
        style={{
          padding: '12px',
          borderTop: '1px solid #f0f0f0',
          flexShrink: 0,
          background: '#fafafa',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <MentionDropdown users={allUsersForMention} onSelect={handleMentionSelect}>
            <button
              style={{
                border: '1px solid #d9d9d9',
                background: '#fff',
                cursor: 'pointer',
                padding: '8px 10px',
                borderRadius: 6,
                color: '#666',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                flexShrink: 0,
                height: 36,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#1677ff';
                e.currentTarget.style.color = '#1677ff';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#d9d9d9';
                e.currentTarget.style.color = '#666';
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>@</span>
            </button>
          </MentionDropdown>

          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter发送，Shift+Enter换行"
            rows={2}
            style={{
              flex: 1,
              resize: 'none',
              padding: '8px 12px',
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              fontSize: 14,
              lineHeight: 1.5,
              outline: 'none',
              fontFamily: 'inherit',
              transition: 'border-color 0.2s',
              minHeight: 36,
              maxHeight: 120,
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = '#1677ff';
              e.currentTarget.style.boxShadow = '0 0 0 2px rgba(22, 119, 255, 0.1)';
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = '#d9d9d9';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />

          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            style={{
              border: 'none',
              background: inputValue.trim() ? '#1677ff' : '#d9d9d9',
              cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
              padding: '8px 12px',
              borderRadius: 6,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              flexShrink: 0,
              height: 36,
            }}
            onMouseEnter={e => {
              if (inputValue.trim()) {
                e.currentTarget.style.background = '#0958d9';
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = inputValue.trim() ? '#1677ff' : '#d9d9d9';
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>@</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatSidebar;
