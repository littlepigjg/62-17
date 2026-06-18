import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  List,
  Avatar,
  Tag,
  Button,
  Space,
  Tabs,
  Select,
  Empty,
  Popconfirm,
  Tooltip,
  Typography,
  App,
  Spin,
  Divider,
} from 'antd';
import {
  HistoryOutlined,
  RollbackOutlined,
  CopyOutlined,
  UserOutlined,
  ClockCircleOutlined,
  DiffOutlined,
  FileTextOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '@/services/api';

const { Text, Title } = Typography;
const { Option } = Select;

export interface HistoryUser {
  id: string;
  name: string;
  avatar?: string;
}

export interface HistorySnapshot {
  id: string;
  version: number;
  doc_id: string;
  content: string;
  created_by: HistoryUser;
  created_at: string;
  insert_count: number;
  delete_count: number;
  message?: string;
}

export interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  docId: string;
  currentUserId?: string;
  isOwner?: boolean;
  onRollback?: (snapshot: HistorySnapshot) => Promise<void> | void;
}

interface DiffLine {
  type: 'add' | 'remove' | 'unchanged';
  content: string;
  lineNum: number;
  leftNum?: number;
  rightNum?: number;
}

const formatTime = (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm:ss');

const computeLineDiff = (fromText: string, toText: string): DiffLine[] => {
  const fromLines = fromText.split('\n');
  const toLines = toText.split('\n');
  const dp: number[][] = Array.from({ length: fromLines.length + 1 }, () =>
    new Array(toLines.length + 1).fill(0),
  );

  for (let i = 1; i <= fromLines.length; i++) {
    for (let j = 1; j <= toLines.length; j++) {
      if (fromLines[i - 1] === toLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = fromLines.length;
  let j = toLines.length;
  const temp: DiffLine[] = [];
  let leftLine = fromLines.length;
  let rightLine = toLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && fromLines[i - 1] === toLines[j - 1]) {
      temp.push({
        type: 'unchanged',
        content: fromLines[i - 1],
        lineNum: 0,
        leftNum: leftLine--,
        rightNum: rightLine--,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({
        type: 'add',
        content: toLines[j - 1],
        lineNum: 0,
        rightNum: rightLine--,
      });
      j--;
    } else {
      temp.push({
        type: 'remove',
        content: fromLines[i - 1],
        lineNum: 0,
        leftNum: leftLine--,
      });
      i--;
    }
  }

  for (let k = temp.length - 1; k >= 0; k--) {
    result.push({ ...temp[k], lineNum: result.length + 1 });
  }
  return result;
};

const renderCharDiff = (line: DiffLine) => {
  if (line.type === 'unchanged') {
    return <span style={{ color: '#666' }}>{line.content || ' '}</span>;
  }
  const chars = line.content.split('');
  return chars.map((ch, idx) => (
    <span
      key={idx}
      style={{
        backgroundColor: line.type === 'add' ? '#f6ffed' : '#fff1f0',
        color: line.type === 'add' ? '#389e0d' : '#cf1322',
        padding: '0 1px',
        borderRadius: 2,
      }}
    >
      {ch || ' '}
    </span>
  ));
};

const HistoryPanel: React.FC<HistoryPanelProps> = ({
  open,
  onClose,
  docId,
  currentUserId,
  isOwner = false,
  onRollback,
}) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fromVersion, setFromVersion] = useState<string | null>(null);
  const [toVersion, setToVersion] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<'line' | 'char'>('line');

  const fetchHistory = async () => {
    if (!docId) return;
    setLoading(true);
    try {
      const data = await api.get(`/collab/history/${docId}`).then(r => r.data);
      const list: HistorySnapshot[] = Array.isArray(data) ? data : (data?.snapshots || []);
      const sorted = [...list].sort((a, b) => b.version - a.version);
      setSnapshots(sorted);
      if (sorted.length > 0) {
        setSelectedId(sorted[0].id);
        if (sorted.length >= 2) {
          setToVersion(sorted[0].id);
          setFromVersion(sorted[1].id);
        } else if (sorted.length === 1) {
          setToVersion(sorted[0].id);
          setFromVersion(sorted[0].id);
        }
      }
    } catch (e) {
      message.error('加载历史记录失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchHistory();
    }
  }, [open, docId]);

  const selectedSnapshot = useMemo(
    () => snapshots.find(s => s.id === selectedId) || null,
    [snapshots, selectedId],
  );

  const fromSnapshot = useMemo(
    () => snapshots.find(s => s.id === fromVersion) || null,
    [snapshots, fromVersion],
  );

  const toSnapshot = useMemo(
    () => snapshots.find(s => s.id === toVersion) || null,
    [snapshots, toVersion],
  );

  const diffLines = useMemo(() => {
    if (!fromSnapshot || !toSnapshot) return [];
    return computeLineDiff(fromSnapshot.content, toSnapshot.content);
  }, [fromSnapshot, toSnapshot]);

  const handleRollback = async () => {
    if (!selectedSnapshot) return;
    try {
      if (onRollback) {
        await onRollback(selectedSnapshot);
      } else {
        await api.post(`/collab/history/${docId}/rollback/${selectedSnapshot.id}`);
      }
      message.success(`已回滚到版本 v${selectedSnapshot.version}`);
      onClose();
    } catch (e) {
      message.error('回滚失败');
    }
  };

  const handleExport = async () => {
    if (!selectedSnapshot) return;
    try {
      await navigator.clipboard.writeText(selectedSnapshot.content);
      message.success(`已复制 v${selectedSnapshot.version} 内容到剪贴板`);
    } catch (e) {
      const textarea = document.createElement('textarea');
      textarea.value = selectedSnapshot.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      message.success(`已复制 v${selectedSnapshot.version} 内容到剪贴板`);
    }
  };

  const renderDiffView = () => {
    if (!fromSnapshot || !toSnapshot) {
      return (
        <div style={{ padding: 40 }}>
          <Empty description="请选择两个版本进行对比" />
        </div>
      );
    }
    if (diffLines.length === 0) {
      return (
        <div style={{ padding: 40 }}>
          <Empty description="两版本内容完全一致" />
        </div>
      );
    }

    return (
      <div
        style={{
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          overflow: 'hidden',
          maxHeight: 500,
          overflowY: 'auto',
          fontFamily: 'Consolas, Monaco, monospace',
          fontSize: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            background: '#fafafa',
            borderBottom: '1px solid #f0f0f0',
            padding: '6px 12px',
            fontWeight: 500,
            fontSize: 12,
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}
        >
          <div style={{ width: 50, color: '#999', textAlign: 'center' }}>#</div>
          <div style={{ width: 60, color: '#999', textAlign: 'center' }}>v{fromSnapshot.version}</div>
          <div style={{ width: 60, color: '#999', textAlign: 'center' }}>v{toSnapshot.version}</div>
          <div style={{ flex: 1 }}>内容</div>
        </div>
        {diffLines.map((line, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              alignItems: 'stretch',
              minHeight: 22,
              borderBottom: idx < diffLines.length - 1 ? '1px solid #fafafa' : 'none',
              backgroundColor:
                line.type === 'add'
                  ? '#f6ffed'
                  : line.type === 'remove'
                    ? '#fff1f0'
                    : 'transparent',
            }}
          >
            <div
              style={{
                width: 50,
                color: '#bbb',
                textAlign: 'center',
                padding: '2px 4px',
                borderRight: '1px solid #f0f0f0',
                flexShrink: 0,
              }}
            >
              {line.type === 'add' ? (
                <span style={{ color: '#52c41a' }}>+</span>
              ) : line.type === 'remove' ? (
                <span style={{ color: '#ff4d4f' }}>-</span>
              ) : (
                ' '
              )}
            </div>
            <div
              style={{
                width: 60,
                color: '#bbb',
                textAlign: 'right',
                padding: '2px 8px',
                borderRight: '1px solid #f0f0f0',
                flexShrink: 0,
                background: line.type === 'add' ? 'transparent' : '#fafafa',
              }}
            >
              {line.leftNum ?? ''}
            </div>
            <div
              style={{
                width: 60,
                color: '#bbb',
                textAlign: 'right',
                padding: '2px 8px',
                borderRight: '1px solid #f0f0f0',
                flexShrink: 0,
                background: line.type === 'remove' ? 'transparent' : '#fafafa',
              }}
            >
              {line.rightNum ?? ''}
            </div>
            <div
              style={{
                flex: 1,
                padding: '2px 8px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {diffMode === 'char' ? renderCharDiff(line) : line.content || ' '}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderFullView = () => {
    if (!selectedSnapshot) {
      return (
        <div style={{ padding: 40 }}>
          <Empty description="请选择一个版本查看完整内容" />
        </div>
      );
    }
    const lines = selectedSnapshot.content.split('\n');
    return (
      <div
        style={{
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          overflow: 'hidden',
          maxHeight: 500,
          overflowY: 'auto',
          fontFamily: 'Consolas, Monaco, monospace',
          fontSize: 12,
        }}
      >
        {lines.map((line, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              minHeight: 22,
              borderBottom: idx < lines.length - 1 ? '1px solid #fafafa' : 'none',
            }}
          >
            <div
              style={{
                width: 50,
                color: '#bbb',
                textAlign: 'right',
                padding: '2px 8px',
                background: '#fafafa',
                borderRight: '1px solid #f0f0f0',
                flexShrink: 0,
                userSelect: 'none',
              }}
            >
              {idx + 1}
            </div>
            <div
              style={{
                flex: 1,
                padding: '2px 8px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: '#333',
              }}
            >
              {line || ' '}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const versionOptions = snapshots.map(s => (
    <Option key={s.id} value={s.id}>
      v{s.version} - {formatTime(s.created_at)} ({s.created_by.name})
    </Option>
  ));

  return (
    <Modal
      title={
        <Space>
          <HistoryOutlined />
          <span>编辑历史与回溯</span>
          <Tag color="blue">共 {snapshots.length} 个版本</Tag>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={1200}
      destroyOnClose
      footer={
        <Space>
          {selectedSnapshot && (
            <>
              {isOwner && (
                <Popconfirm
                  title="确认回滚到此版本？"
                  description={`将回滚到 v${selectedSnapshot.version}，此操作会创建一个新的版本。`}
                  onConfirm={handleRollback}
                  okText="确认回滚"
                  cancelText="取消"
                >
                  <Button type="primary" danger icon={<RollbackOutlined />}>
                    回滚到此版本
                  </Button>
                </Popconfirm>
              )}
              <Button icon={<CopyOutlined />} onClick={handleExport}>
                导出该版本内容
              </Button>
            </>
          )}
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      <Spin spinning={loading}>
        {snapshots.length === 0 ? (
          <div style={{ padding: 60 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Space direction="vertical">
                  <span>暂无历史版本</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    编辑文档后将自动生成快照记录
                  </Text>
                </Space>
              }
            />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
            <div>
              <div
                style={{
                  fontWeight: 500,
                  marginBottom: 8,
                  padding: '4px 0',
                  borderBottom: '1px solid #f0f0f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ClockCircleOutlined style={{ color: '#1677ff' }} />
                版本列表
              </div>
              <div
                style={{
                  maxHeight: 560,
                  overflowY: 'auto',
                  paddingRight: 4,
                  marginRight: -4,
                }}
              >
                <List
                  dataSource={snapshots}
                  renderItem={(s) => {
                    const isSelected = selectedId === s.id;
                    const isMine = s.created_by.id === currentUserId;
                    return (
                      <div
                        key={s.id}
                        onClick={() => {
                          setSelectedId(s.id);
                          if (!toVersion) setToVersion(s.id);
                        }}
                        style={{
                          padding: 12,
                          marginBottom: 8,
                          borderRadius: 6,
                          border: isSelected
                            ? '1px solid #1677ff'
                            : '1px solid #f0f0f0',
                          backgroundColor: isSelected ? '#e6f4ff' : '#fff',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.backgroundColor = '#f5f5f5';
                            e.currentTarget.style.borderColor = '#d9d9d9';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.backgroundColor = '#fff';
                            e.currentTarget.style.borderColor = '#f0f0f0';
                          }
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 8,
                          }}
                        >
                          <Space>
                            <Tag color={isSelected ? 'blue' : 'default'}>
                              v{s.version}
                            </Tag>
                            {isMine && <Tag color="purple">我</Tag>}
                          </Space>
                          <Space size={4}>
                            <Tooltip title={`插入 ${s.insert_count} 字符`}>
                              <Tag
                                color="success"
                                style={{ margin: 0, fontSize: 11, padding: '0 4px' }}
                              >
                                +{s.insert_count}
                              </Tag>
                            </Tooltip>
                            <Tooltip title={`删除 ${s.delete_count} 字符`}>
                              <Tag
                                color="error"
                                style={{ margin: 0, fontSize: 11, padding: '0 4px' }}
                              >
                                -{s.delete_count}
                              </Tag>
                            </Tooltip>
                          </Space>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                          <Avatar
                            size={24}
                            src={s.created_by.avatar}
                            icon={<UserOutlined />}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {s.created_by.name}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: '#999',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <ClockCircleOutlined style={{ fontSize: 10 }} />
                              {formatTime(s.created_at)}
                            </div>
                          </div>
                        </div>
                        {s.message && (
                          <Text
                            type="secondary"
                            style={{
                              fontSize: 12,
                              display: 'block',
                              paddingTop: 6,
                              borderTop: '1px dashed #f0f0f0',
                            }}
                          >
                            {s.message}
                          </Text>
                        )}
                      </div>
                    );
                  }}
                />
              </div>
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <Space size="small" wrap>
                  <Space size={4}>
                    <ArrowLeftOutlined style={{ color: '#999' }} />
                    <Select
                      placeholder="From版本"
                      style={{ width: 240 }}
                      value={fromVersion}
                      onChange={setFromVersion}
                      size="small"
                      allowClear
                    >
                      {versionOptions}
                    </Select>
                  </Space>
                  <Text type="secondary">→</Text>
                  <Space size={4}>
                    <Select
                      placeholder="To版本"
                      style={{ width: 240 }}
                      value={toVersion}
                      onChange={setToVersion}
                      size="small"
                      allowClear
                    >
                      {versionOptions}
                    </Select>
                    <ArrowRightOutlined style={{ color: '#999' }} />
                  </Space>
                </Space>
                <Space size={4}>
                  <Button
                    size="small"
                    type={diffMode === 'line' ? 'primary' : 'default'}
                    onClick={() => setDiffMode('line')}
                  >
                    逐行
                  </Button>
                  <Button
                    size="small"
                    type={diffMode === 'char' ? 'primary' : 'default'}
                    onClick={() => setDiffMode('char')}
                  >
                    逐字符
                  </Button>
                </Space>
              </div>

              <Tabs
                size="small"
                items={[
                  {
                    key: 'diff',
                    label: (
                      <Space size={4}>
                        <DiffOutlined />
                        差异对比
                      </Space>
                    ),
                    children: renderDiffView(),
                  },
                  {
                    key: 'full',
                    label: (
                      <Space size={4}>
                        <FileTextOutlined />
                        查看该版本完整内容
                      </Space>
                    ),
                    children: renderFullView(),
                  },
                ]}
              />

              {selectedSnapshot && (
                <>
                  <Divider style={{ margin: '12px 0' }} />
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12, width: 80 }}>
                        当前选中：
                      </Text>
                      <Space size={4}>
                        <Tag color="blue">v{selectedSnapshot.version}</Tag>
                        <Avatar
                          size={18}
                          src={selectedSnapshot.created_by.avatar}
                          icon={<UserOutlined />}
                        />
                        <Text style={{ fontSize: 12 }}>
                          {selectedSnapshot.created_by.name}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatTime(selectedSnapshot.created_at)}
                        </Text>
                      </Space>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12, width: 80 }}>
                        变更统计：
                      </Text>
                      <Space size={4}>
                        <Tag color="success" style={{ margin: 0 }}>
                          插入 {selectedSnapshot.insert_count} 字符
                        </Tag>
                        <Tag color="error" style={{ margin: 0 }}>
                          删除 {selectedSnapshot.delete_count} 字符
                        </Tag>
                      </Space>
                    </div>
                  </Space>
                </>
              )}
            </div>
          </div>
        )}
      </Spin>
    </Modal>
  );
};

export default HistoryPanel;
