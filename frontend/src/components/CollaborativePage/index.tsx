import React, { useEffect, useState, useMemo } from 'react';
import {
  Button,
  Space,
  Tag,
  Tooltip,
  Dropdown,
  Avatar,
  Skeleton,
  Spin,
  App,
  Input,
  Divider,
} from 'antd';
import {
  ArrowLeftOutlined,
  HistoryOutlined,
  TeamOutlined,
  UserOutlined,
  EditOutlined,
  CrownOutlined,
  MessageOutlined,
  EyeOutlined,
  CheckOutlined,
  SettingOutlined,
  BgColorsOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import CollaborativeEditor from '@/components/CollaborativeEditor';
import ChatSidebar from '@/components/ChatSidebar';
import NotificationCenter from '@/components/NotificationCenter';
import ConflictResolver from '@/components/ConflictResolver';
import HistoryPanel from '@/components/HistoryPanel';
import PermissionManager from '@/components/PermissionManager';
import { useCollabStore } from '@/store';
import type { ScriptTemplate } from '@/types';

interface CollaborativePageProps {
  docId: string;
  docName?: string;
  interpreter?: string;
  onBack?: () => void;
  initialPermission?: 'owner' | 'editor' | 'commenter' | 'viewer';
}

const USER_COLORS = [
  '#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1',
  '#13c2c2', '#eb2f96', '#fa8c16', '#2f54eb', '#a0d911',
];

const generateRandomUserName = () => '用户' + Math.floor(Math.random() * 10000);
const generateRandomUserColor = () => USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

const permissionMeta: Record<
  'owner' | 'editor' | 'commenter' | 'viewer',
  { label: string; color: string; icon: React.ReactNode }
> = {
  owner: { label: '所有者', color: 'gold', icon: <CrownOutlined /> },
  editor: { label: '编辑者', color: 'blue', icon: <EditOutlined /> },
  commenter: { label: '评论者', color: 'purple', icon: <MessageOutlined /> },
  viewer: { label: '查看者', color: 'default', icon: <EyeOutlined /> },
};

const CollaborativePage: React.FC<CollaborativePageProps> = ({
  docId,
  docName = '未命名文档',
  interpreter,
  onBack,
  initialPermission,
}) => {
  const { message } = App.useApp();
  const {
    currentUserId,
    currentUserName,
    currentUserColor,
    permission,
    isConnected,
    isCollabMode,
    conflictState,
    text,
    setCurrentUser,
    generateUserId,
    joinDocument,
    leaveDocument,
    resolveConflict,
    setPermission,
  } = useCollabStore();

  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(currentUserName);
  const [editorHeight, setEditorHeight] = useState('calc(100vh - 120px)');

  const effectivePermission = useMemo(
    () => permission ?? initialPermission ?? 'owner',
    [permission, initialPermission]
  );

  const isReadOnly = useMemo(
    () => effectivePermission === 'viewer' || effectivePermission === 'commenter',
    [effectivePermission]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (initialPermission) {
          setPermission(initialPermission);
        }
        await joinDocument(docId);
      } catch (e: any) {
        console.error('[CollaborativePage] join failed:', e);
        message.error('加入协作会话失败: ' + (e.message || '未知错误'));
      } finally {
        setTimeout(() => setLoading(false), 500);
      }
    })();

    return () => {
      leaveDocument();
    };
  }, [docId, initialPermission]);

  useEffect(() => {
    const updateHeight = () => {
      setEditorHeight('calc(100vh - 120px)');
    };
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const handleResolveConflict = async (mergedContent: string) => {
    resolveConflict(mergedContent, false);
  };

  const handleSwitchUser = () => {
    generateUserId();
    message.success('已切换为新用户身份');
    setUserMenuOpen(false);
  };

  const handleRandomColor = () => {
    const newColor = generateRandomUserColor();
    setCurrentUser(currentUserId, currentUserName, newColor);
    setUserMenuOpen(false);
  };

  const handleApplyName = () => {
    const name = tempName.trim();
    if (name) {
      setCurrentUser(currentUserId, name, currentUserColor);
    } else {
      setTempName(currentUserName);
    }
    setEditingName(false);
    setUserMenuOpen(false);
  };

  const userMenuItems = [
    {
      key: 'name-header',
      disabled: true,
      label: (
        <div style={{ padding: '4px 12px', color: '#999', fontSize: 12 }}>
          当前用户信息
        </div>
      ),
    },
    {
      key: 'name-input',
      label: editingName ? (
        <Space.Compact style={{ width: '100%' }}>
          <Input
            size="small"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onPressEnter={handleApplyName}
            autoFocus
            style={{ width: 150 }}
            onClick={(e) => e.stopPropagation()}
          />
          <Button size="small" type="primary" icon={<CheckOutlined />} onClick={handleApplyName}>
            确定
          </Button>
        </Space.Compact>
      ) : (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setTempName(currentUserName);
            setEditingName(true);
          }}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <UserOutlined />
          <span>修改名称</span>
        </div>
      ),
    },
    {
      key: 'color',
      label: (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <BgColorsOutlined />
            <span>用户颜色</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 20 }}>
            {USER_COLORS.map((c) => (
              <Tooltip key={c} title={c}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentUser(currentUserId, currentUserName, c);
                    setUserMenuOpen(false);
                  }}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: c === currentUserColor ? '2px solid #333' : '2px solid transparent',
                    background: c,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              </Tooltip>
            ))}
            <Tooltip title="随机颜色">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRandomColor();
                }}
              >
                随机
              </Button>
            </Tooltip>
          </div>
        </div>
      ),
    },
    { type: 'divider' as const },
    {
      key: 'switch',
      icon: <TeamOutlined />,
      label: '切换为新用户',
      onClick: handleSwitchUser,
    },
  ];

  if (loading) {
    return (
      <div style={{ padding: 24, height: '100%', background: '#fff' }}>
        <Skeleton active paragraph={{ rows: 4 }} />
        <Divider />
        <Spin tip="正在建立协作连接...">
          <div style={{ padding: 100 }} />
        </Spin>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#f5f5f5',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: '#fff',
          borderBottom: '1px solid #e8e8e8',
          flexShrink: 0,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Space size={12} wrap>
          <Tooltip title="返回">
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
            >
              返回
            </Button>
          </Tooltip>

          <Divider type="vertical" style={{ height: 24 }} />

          <Space size={8} align="center">
            <span style={{ fontSize: 16, fontWeight: 600, color: '#222' }}>
              {docName}
            </span>
            {interpreter && (
              <Tag color="blue" style={{ margin: 0 }}>
                {interpreter}
              </Tag>
            )}
            <Tag
              color={permissionMeta[effectivePermission].color}
              icon={permissionMeta[effectivePermission].icon}
            >
              {permissionMeta[effectivePermission].label}
            </Tag>
            {!isConnected && isCollabMode && (
              <Tag color="warning">连接中...</Tag>
            )}
            {isConnected && (
              <Tag color="success">已连接</Tag>
            )}
          </Space>
        </Space>

        <Space size={8} wrap>
          <NotificationCenter />

          <Tooltip title="编辑历史">
            <Button
              icon={<HistoryOutlined />}
              onClick={() => setHistoryOpen(true)}
            >
              历史
            </Button>
          </Tooltip>

          {effectivePermission === 'owner' && (
            <Tooltip title="权限管理">
              <Button
                icon={<SettingOutlined />}
                onClick={() => setPermissionOpen(true)}
              >
                权限
              </Button>
            </Tooltip>
          )}

          <Tooltip title={sidebarOpen ? '收起讨论' : '展开讨论'}>
            <Button
              icon={<MessageOutlined />}
              onClick={() => setSidebarOpen((v) => !v)}
              type={sidebarOpen ? 'primary' : 'default'}
            >
              讨论
            </Button>
          </Tooltip>

          <Divider type="vertical" style={{ height: 24 }} />

          <Dropdown
            menu={{ items: userMenuItems }}
            trigger={['click']}
            open={userMenuOpen}
            onOpenChange={setUserMenuOpen}
            placement="bottomRight"
          >
            <Button style={{ padding: '0 10px', height: 32 }}>
              <Space size={6}>
                <Avatar
                  size={22}
                  style={{
                    background: currentUserColor,
                    border: `2px solid ${currentUserColor}`,
                    fontSize: 12,
                  }}
                  icon={<UserOutlined />}
                >
                  {currentUserName.charAt(0).toUpperCase()}
                </Avatar>
                <span style={{ fontSize: 13 }}>{currentUserName}</span>
              </Space>
            </Button>
          </Dropdown>
        </Space>
      </div>

      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
          background: '#f0f2f5',
        }}
      >
        <div
          style={{
            flex: 1,
            padding: 16,
            overflow: 'auto',
            minWidth: 0,
          }}
        >
          <CollaborativeEditor
            docId={docId}
            initialText={text}
            userId={currentUserId}
            userName={currentUserName}
            userColor={currentUserColor}
            role={effectivePermission}
            height={editorHeight}
            onHistoryClick={() => setHistoryOpen(true)}
            onChatToggle={() => setSidebarOpen((v) => !v)}
            onPermissionClick={() => effectivePermission === 'owner' && setPermissionOpen(true)}
          />
        </div>

        {sidebarOpen && (
          <ChatSidebar
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
        )}
      </div>

      {conflictState && (
        <ConflictResolver
          open={!!conflictState}
          onClose={() => useCollabStore.setState({ conflictState: null })}
          baseContent={conflictState.baseText}
          localContent={conflictState.localText}
          remoteContent={conflictState.remoteText}
          localAuthor={currentUserName}
          remoteAuthor="其他用户"
          docTitle={docName}
          onResolve={handleResolveConflict}
        />
      )}

      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        docId={docId}
        currentUserId={currentUserId}
        isOwner={effectivePermission === 'owner'}
      />

      <PermissionManager
        open={permissionOpen}
        onClose={() => setPermissionOpen(false)}
        docId={docId}
        currentUserId={currentUserId}
      />
    </div>
  );
};

export default CollaborativePage;
