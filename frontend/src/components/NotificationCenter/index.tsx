import React, { useState, useRef, useEffect } from 'react';
import {
  BellOutlined,
  CheckOutlined,
  CheckSquareOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Tooltip, Avatar, Popover, Empty } from 'antd';
import dayjs from 'dayjs';
import { useCollabStore } from '@/store';
import type { NotificationData } from '@/types';

interface NotificationItemProps {
  notification: NotificationData;
  onMarkRead: (id: string) => void;
  onClick: (notification: NotificationData) => void;
}

const getDicebearUrl = (seed: string) => {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
};

const getInitial = (name: string) => {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
};

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onMarkRead,
  onClick,
}) => {
  const isUnread = !notification.read;

  const getTimeDisplay = (timestamp: string) => {
    const now = dayjs();
    const target = dayjs(timestamp);
    const diffMinutes = now.diff(target, 'minute');
    const diffHours = now.diff(target, 'hour');
    const diffDays = now.diff(target, 'day');

    if (diffMinutes < 1) return '刚刚';
    if (diffMinutes < 60) return `${diffMinutes}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return target.format('MM-DD HH:mm');
  };

  const truncateContent = (content: string, maxLen = 60) => {
    if (content.length <= maxLen) return content;
    return content.slice(0, maxLen) + '...';
  };

  const getFromUserInfo = () => {
    const state = useCollabStore.getState();
    const onlineUser = Array.from(state.onlineUsers.values()).find(
      u => notification.related_doc_id && u.user_id !== state.currentUserId
    );
    const name = notification.title.replace(/在.*中提到你/, '').trim() || '用户';
    return {
      name,
      color: onlineUser?.user_color || '#1677ff',
    };
  };

  const fromUser = getFromUserInfo();

  return (
    <div
      onClick={() => onClick(notification)}
      style={{
        padding: '12px',
        borderBottom: '1px solid #f0f0f0',
        cursor: 'pointer',
        background: isUnread ? 'rgba(22, 119, 255, 0.04)' : 'transparent',
        transition: 'background 0.2s',
        position: 'relative',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = isUnread
          ? 'rgba(22, 119, 255, 0.08)'
          : '#fafafa';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = isUnread
          ? 'rgba(22, 119, 255, 0.04)'
          : 'transparent';
      }}
    >
      {isUnread && (
        <span
          style={{
            position: 'absolute',
            top: 16,
            left: 12,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#ff4d4f',
          }}
        />
      )}

      <div style={{ display: 'flex', gap: 10, paddingLeft: isUnread ? 14 : 0 }}>
        <Avatar
          size={36}
          src={getDicebearUrl(fromUser.name)}
          style={{
            border: `2px solid ${fromUser.color}`,
            background: '#fff',
            flexShrink: 0,
          }}
        >
          {getInitial(fromUser.name)}
        </Avatar>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 4,
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {notification.type === 'mention' && (
                <span style={{ color: '#1677ff', fontSize: 13, flexShrink: 0, fontWeight: 700, lineHeight: 1 }}>@</span>
              )}
              <span
                style={{
                  fontWeight: isUnread ? 600 : 500,
                  fontSize: 13,
                  color: '#333',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {notification.title}
              </span>
            </div>
            <Tooltip title={dayjs(notification.timestamp).format('YYYY-MM-DD HH:mm:ss')}>
              <span
                style={{
                  fontSize: 11,
                  color: '#999',
                  flexShrink: 0,
                }}
              >
                {getTimeDisplay(notification.timestamp)}
              </span>
            </Tooltip>
          </div>

          <div
            style={{
              fontSize: 12,
              color: '#666',
              lineHeight: 1.5,
              marginBottom: 8,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {truncateContent(notification.content)}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {isUnread && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onMarkRead(notification.id);
                }}
                style={{
                  border: '1px solid #d9d9d9',
                  background: '#fff',
                  cursor: 'pointer',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  color: '#666',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#52c41a';
                  e.currentTarget.style.color = '#52c41a';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#d9d9d9';
                  e.currentTarget.style.color = '#666';
                }}
              >
                <CheckOutlined />
                标为已读
              </button>
            )}
            <div
              style={{
                marginLeft: isUnread ? 'auto' : 0,
                fontSize: 11,
                color: '#1677ff',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              查看消息
              <RightOutlined style={{ fontSize: 10 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const NotificationCenter: React.FC = () => {
  const {
    notifications,
    unreadNotifCount,
    markNotifRead,
    markAllNotifRead,
    setSidebarOpen,
    triggerMentionFlash,
    currentUserId,
  } = useCollabStore();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = (notification: NotificationData) => {
    setSidebarOpen(true);
    triggerMentionFlash();

    if (!notification.read) {
      markNotifRead(notification.id);
    }

    if (notification.related_message_id) {
      const messageEl = document.querySelector(`[data-message-id="${notification.related_message_id}"]`);
      if (messageEl) {
        messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        messageEl.classList.add('highlight-message');
        setTimeout(() => {
          messageEl.classList.remove('highlight-message');
        }, 3000);
      }
    }

    setOpen(false);
  };

  const mentionNotifications = notifications.filter(n => n.type === 'mention');

  const panelContent = (
    <div style={{ width: 360, maxHeight: 480, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>通知中心</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {unreadNotifCount > 0 && (
            <span
              style={{
                fontSize: 11,
                color: '#ff4d4f',
                background: 'rgba(255, 77, 79, 0.1)',
                padding: '2px 8px',
                borderRadius: 10,
              }}
            >
              {unreadNotifCount}条未读
            </span>
          )}
          {unreadNotifCount > 0 && (
            <button
              onClick={markAllNotifRead}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 12,
                color: '#1677ff',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(22, 119, 255, 0.1)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <CheckSquareOutlined />
              全部标为已读
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {mentionNotifications.length === 0 ? (
          <div style={{ padding: '40px 20px' }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ color: '#999' }}>
                  暂无通知
                  <br />
                  当有人提到你时会收到通知
                </span>
              }
            />
          </div>
        ) : (
          mentionNotifications.map(notif => (
            <NotificationItem
              key={notif.id}
              notification={notif}
              onMarkRead={markNotifRead}
              onClick={handleNotificationClick}
            />
          ))
        )}
      </div>
    </div>
  );

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <Popover
        content={panelContent}
        trigger="click"
        open={open}
        onOpenChange={setOpen}
        placement="bottomRight"
        arrow={false}
        overlayStyle={{
          padding: 0,
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
        }}
      >
        <Tooltip title="通知中心">
          <button
            style={{
              position: 'relative',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '8px 10px',
              borderRadius: 6,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              opacity: open ? 1 : 0.85,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.opacity = open ? '1' : '0.85';
            }}
          >
            <BellOutlined style={{ fontSize: 18 }} />
            {unreadNotifCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 0,
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  background: '#ff4d4f',
                  color: '#fff',
                  fontSize: 11,
                  lineHeight: '18px',
                  textAlign: 'center',
                  borderRadius: 9,
                  border: '2px solid #001529',
                  fontWeight: 600,
                  boxSizing: 'content-box',
                }}
              >
                {unreadNotifCount > 99 ? '99+' : unreadNotifCount}
              </span>
            )}
          </button>
        </Tooltip>
      </Popover>
    </div>
  );
};

export default NotificationCenter;
