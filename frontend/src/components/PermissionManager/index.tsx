import React, { useEffect, useState, useMemo } from 'react';
import {
  Modal,
  List,
  Avatar,
  Tag,
  Button,
  Space,
  Select,
  Input,
  Empty,
  Popconfirm,
  Tooltip,
  Typography,
  App,
  Spin,
  Divider,
  Alert,
} from 'antd';
import {
  TeamOutlined,
  UserOutlined,
  SearchOutlined,
  PlusOutlined,
  DeleteOutlined,
  LinkOutlined,
  CrownOutlined,
  EditOutlined,
  MessageOutlined,
  EyeOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import api from '@/services/api';

const { Text } = Typography;
const { Option } = Select;

export type PermissionLevel = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface UserItem {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
}

export interface DocumentPermission {
  user: UserItem;
  level: PermissionLevel;
  granted_at: string;
  granted_by?: string;
}

export interface PermissionManagerProps {
  open: boolean;
  onClose: () => void;
  docId: string;
  currentUserId: string;
}

const PERMISSION_META: Record<
  PermissionLevel,
  { label: string; color: string; icon: React.ReactNode; desc: string }
> = {
  owner: {
    label: '所有者',
    color: 'gold',
    icon: <CrownOutlined />,
    desc: '拥有完全控制权，可管理权限、删除文档、回滚版本',
  },
  editor: {
    label: '编辑者',
    color: 'blue',
    icon: <EditOutlined />,
    desc: '可编辑文档内容，管理评论',
  },
  commenter: {
    label: '评论者',
    color: 'purple',
    icon: <MessageOutlined />,
    desc: '可查看文档并添加评论，但不能修改内容',
  },
  viewer: {
    label: '查看者',
    color: 'default',
    icon: <EyeOutlined />,
    desc: '仅可查看文档内容，不能编辑或评论',
  },
};

const LEVEL_ORDER: PermissionLevel[] = ['owner', 'editor', 'commenter', 'viewer'];

const canModifyPermission = (
  myLevel: PermissionLevel,
  targetLevel: PermissionLevel,
): boolean => {
  if (myLevel === 'owner') return targetLevel !== 'owner';
  return false;
};

const PermissionManager: React.FC<PermissionManagerProps> = ({
  open,
  onClose,
  docId,
  currentUserId,
}) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [permissions, setPermissions] = useState<DocumentPermission[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<UserItem[]>([]);
  const [defaultLevel, setDefaultLevel] = useState<PermissionLevel>('viewer');

  const currentUserPerm = useMemo(
    () => permissions.find(p => p.user.id === currentUserId) || null,
    [permissions, currentUserId],
  );

  const myLevel: PermissionLevel = currentUserPerm?.level || 'viewer';
  const canManage = myLevel === 'owner';

  const fetchPermissions = async () => {
    if (!docId) return;
    setLoading(true);
    try {
      const data = await api
        .get(`/collab/documents/${docId}/permissions`)
        .then(r => r.data);
      const list: DocumentPermission[] = Array.isArray(data)
        ? data
        : data?.permissions || [];
      list.sort(
        (a, b) =>
          LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
          a.user.name.localeCompare(b.user.name),
      );
      setPermissions(list);
    } catch (e) {
      message.error('加载权限列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchPermissions();
      setSearchKeyword('');
      setSearchResults([]);
    }
  }, [open, docId]);

  const handleSearch = async (keyword: string) => {
    setSearchKeyword(keyword);
    if (!keyword.trim()) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const data = await api
        .get('/collab/users/search', { params: { q: keyword, doc_id: docId } })
        .then(r => r.data);
      const results: UserItem[] = Array.isArray(data) ? data : data?.users || [];
      const existingIds = new Set(permissions.map(p => p.user.id));
      setSearchResults(results.filter(u => !existingIds.has(u.id)));
    } catch (e) {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAddMember = async (user: UserItem, level: PermissionLevel) => {
    try {
      await api.post(`/collab/documents/${docId}/permissions`, {
        user_id: user.id,
        level,
      });
      message.success(`已邀请 ${user.name} 作为${PERMISSION_META[level].label}`);
      setSearchResults(prev => prev.filter(u => u.id !== user.id));
      fetchPermissions();
    } catch (e) {
      message.error('添加成员失败');
    }
  };

  const handleUpdateLevel = async (userId: string, newLevel: PermissionLevel) => {
    try {
      await api.post(`/collab/documents/${docId}/permissions`, {
        user_id: userId,
        level: newLevel,
      });
      message.success('权限已更新');
      setPermissions(prev =>
        prev.map(p => (p.user.id === userId ? { ...p, level: newLevel } : p)),
      );
    } catch (e) {
      message.error('更新权限失败');
    }
  };

  const handleRemoveMember = async (userId: string, userName: string) => {
    try {
      await api.delete(`/collab/documents/${docId}/permissions/${userId}`);
      message.success(`已移除 ${userName}`);
      setPermissions(prev => prev.filter(p => p.user.id !== userId));
    } catch (e) {
      message.error('移除成员失败');
    }
  };

  const handleCopyShareLink = async () => {
    const baseUrl = window.location.origin + window.location.pathname;
    const link = `${baseUrl}?doc=${docId}&invite=1`;
    try {
      await navigator.clipboard.writeText(link);
      message.success('分享链接已复制到剪贴板');
    } catch (e) {
      const textarea = document.createElement('textarea');
      textarea.value = link;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      message.success('分享链接已复制到剪贴板');
    }
  };

  const renderPermissionSelect = (perm: DocumentPermission) => {
    const isSelf = perm.user.id === currentUserId;
    const targetIsOwner = perm.level === 'owner';
    const canModify = canManage && !targetIsOwner && !isSelf;

    if (!canModify) {
      return (
        <Tag
          color={PERMISSION_META[perm.level].color}
          icon={PERMISSION_META[perm.level].icon}
        >
          {PERMISSION_META[perm.level].label}
        </Tag>
      );
    }

    return (
      <Select
        size="small"
        value={perm.level}
        style={{ width: 110 }}
        onChange={(val) => handleUpdateLevel(perm.user.id, val)}
        optionLabelProp="label"
      >
        {(['editor', 'commenter', 'viewer'] as PermissionLevel[]).map(lv => (
          <Option key={lv} value={lv} label={PERMISSION_META[lv].label}>
            <Space size={4}>
              {PERMISSION_META[lv].icon}
              <span>{PERMISSION_META[lv].label}</span>
            </Space>
          </Option>
        ))}
      </Select>
    );
  };

  const permissionList = useMemo(() => {
    const ownerList = permissions.filter(p => p.level === 'owner');
    const otherList = permissions.filter(p => p.level !== 'owner');
    return [...ownerList, ...otherList];
  }, [permissions]);

  return (
    <Modal
      title={
        <Space>
          <TeamOutlined />
          <span>权限管理</span>
          <Tag color="blue">{permissions.length} 人</Tag>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={720}
      destroyOnClose
      footer={
        <Space>
          <Button icon={<LinkOutlined />} onClick={handleCopyShareLink}>
            复制分享链接
          </Button>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      <Spin spinning={loading}>
        {!canManage && (
          <Alert
            type="warning"
            showIcon
            message="仅所有者可管理文档权限"
            description="你当前身份为查看者/编辑者，如需调整权限请联系文档所有者"
            style={{ marginBottom: 16 }}
          />
        )}

        {canManage && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontWeight: 500,
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <PlusOutlined style={{ color: '#52c41a' }} />
              邀请成员
            </div>
            <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
              <Input
                prefix={<SearchOutlined />}
                placeholder="搜索用户（姓名/邮箱）"
                value={searchKeyword}
                onChange={(e) => handleSearch(e.target.value)}
                allowClear
              />
              <Select
                value={defaultLevel}
                onChange={setDefaultLevel}
                style={{ width: 120 }}
                optionLabelProp="label"
              >
                {(['editor', 'commenter', 'viewer'] as PermissionLevel[]).map(lv => (
                  <Option key={lv} value={lv} label={PERMISSION_META[lv].label}>
                    <Space size={4}>
                      {PERMISSION_META[lv].icon}
                      <span>{PERMISSION_META[lv].label}</span>
                    </Space>
                  </Option>
                ))}
              </Select>
            </Space.Compact>

            {searchLoading ? (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <Spin size="small" />
              </div>
            ) : searchResults.length > 0 ? (
              <List
                size="small"
                bordered
                style={{ maxHeight: 200, overflowY: 'auto' }}
                dataSource={searchResults}
                renderItem={(user) => (
                  <List.Item
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                    }}
                  >
                    <Space size={8}>
                      <Avatar size={28} src={user.avatar} icon={<UserOutlined />} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>
                          {user.name}
                        </div>
                        {user.email && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {user.email}
                          </Text>
                        )}
                      </div>
                    </Space>
                    <Space>
                      <Select
                        size="small"
                        defaultValue={defaultLevel}
                        style={{ width: 100 }}
                        onChange={(val) => setDefaultLevel(val)}
                        onSelect={(val) => handleAddMember(user, val)}
                        optionLabelProp="label"
                        value={undefined}
                        placeholder="选择权限"
                      >
                        {(['editor', 'commenter', 'viewer'] as PermissionLevel[]).map(
                          lv => (
                            <Option
                              key={lv}
                              value={lv}
                              label={PERMISSION_META[lv].label}
                            >
                              <Space size={4}>
                                {PERMISSION_META[lv].icon}
                                <span>{PERMISSION_META[lv].label}</span>
                              </Space>
                            </Option>
                          ),
                        )}
                      </Select>
                      <Tooltip title={`添加为${PERMISSION_META[defaultLevel].label}`}>
                        <Button
                          size="small"
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={() => handleAddMember(user, defaultLevel)}
                        >
                          添加
                        </Button>
                      </Tooltip>
                    </Space>
                  </List.Item>
                )}
              />
            ) : searchKeyword ? (
              <div style={{ padding: 16, border: '1px dashed #d9d9d9', borderRadius: 4 }}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="未找到匹配的用户"
                />
              </div>
            ) : null}
          </div>
        )}

        <Divider style={{ margin: '16px 0' }} />

        <div
          style={{
            fontWeight: 500,
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <UserOutlined style={{ color: '#1677ff' }} />
          当前成员
          <Tooltip title="权限等级说明">
            <InfoCircleOutlined style={{ color: '#999', fontSize: 12 }} />
          </Tooltip>
        </div>

        {permissionList.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无成员"
          />
        ) : (
          <List
            bordered
            style={{ maxHeight: 360, overflowY: 'auto' }}
            dataSource={permissionList}
            renderItem={(perm) => {
              const isOwner = perm.level === 'owner';
              const isSelf = perm.user.id === currentUserId;
              const canRemove =
                canManage && !isOwner && !isSelf;
              const meta = PERMISSION_META[perm.level];

              return (
                <List.Item
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 16px',
                    background: isSelf ? '#fffbe6' : 'transparent',
                  }}
                >
                  <Space size={10} style={{ flex: 1, minWidth: 0 }}>
                    <Avatar
                      size={36}
                      src={perm.user.avatar}
                      icon={<UserOutlined />}
                      style={{
                        border: isOwner ? '2px solid #faad14' : 'none',
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexWrap: 'wrap',
                        }}
                      >
                        <Text strong style={{ fontSize: 14 }}>
                          {perm.user.name}
                        </Text>
                        {isOwner && (
                          <Tag
                            color="gold"
                            icon={<CrownOutlined />}
                            style={{ margin: 0 }}
                          >
                            Owner
                          </Tag>
                        )}
                        {isSelf && (
                          <Tag color="blue" style={{ margin: 0 }}>
                            我
                          </Tag>
                        )}
                      </div>
                      {perm.user.email && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {perm.user.email}
                        </Text>
                      )}
                    </div>
                  </Space>

                  <Space size={8}>
                    <Tooltip title={meta.desc}>
                      {renderPermissionSelect(perm)}
                    </Tooltip>
                    {canRemove && (
                      <Popconfirm
                        title={`确认移除 ${perm.user.name}？`}
                        description="移除后该用户将失去对文档的访问权限"
                        onConfirm={() =>
                          handleRemoveMember(perm.user.id, perm.user.name)
                        }
                        okText="确认移除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                      >
                        <Button
                          size="small"
                          danger
                          type="text"
                          icon={<DeleteOutlined />}
                        />
                      </Popconfirm>
                    )}
                  </Space>
                </List.Item>
              );
            }}
          />
        )}

        <Divider style={{ margin: '16px 0' }} />

        <div style={{ fontSize: 12, color: '#999', lineHeight: 1.8 }}>
          <div style={{ fontWeight: 500, marginBottom: 4, color: '#666' }}>
            权限等级说明：
          </div>
          {(Object.keys(PERMISSION_META) as PermissionLevel[]).map(lv => (
            <div key={lv} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
              <Tag
                color={PERMISSION_META[lv].color}
                icon={PERMISSION_META[lv].icon}
                style={{ margin: 0, flexShrink: 0 }}
              >
                {PERMISSION_META[lv].label}
              </Tag>
              <Text type="secondary">{PERMISSION_META[lv].desc}</Text>
            </div>
          ))}
        </div>
      </Spin>
    </Modal>
  );
};

export default PermissionManager;
