import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Modal,
  Button,
  Space,
  Typography,
  App,
  Tag,
  Tooltip,
  Alert,
  Empty,
  Radio,
  Divider,
  Input,
} from 'antd';
import {
  WarningOutlined,
  CheckOutlined,
  CloseOutlined,
  LeftOutlined,
  RightOutlined,
  EditOutlined,
  FileTextOutlined,
  SyncOutlined,
  BulbOutlined,
  CopyOutlined,
} from '@ant-design/icons';

const { Text } = Typography;
const { TextArea } = Input;

export interface ConflictBlock {
  id: string;
  start: number;
  end: number;
  localContent: string;
  remoteContent: string;
  baseContent: string;
  resolved?: 'local' | 'remote' | 'manual';
  manualContent?: string;
}

export interface ConflictResolverProps {
  open: boolean;
  onClose: () => void;
  baseContent: string;
  localContent: string;
  remoteContent: string;
  localAuthor?: string;
  remoteAuthor?: string;
  docTitle?: string;
  onResolve: (mergedContent: string) => Promise<void> | void;
}

interface ParsedLine {
  num: number;
  content: string;
  inConflict: boolean;
  conflictId?: string;
  conflictSide?: 'local' | 'remote' | 'base';
  resolved?: 'local' | 'remote' | 'manual';
}

const detectConflicts = (
  local: string,
  remote: string,
  base: string,
): ConflictBlock[] => {
  const conflicts: ConflictBlock[] = [];
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');
  const baseLines = base.split('\n');

  const maxLen = Math.max(localLines.length, remoteLines.length, baseLines.length);
  let inConflict = false;
  let conflictStart = -1;
  let conflictLocalLines: string[] = [];
  let conflictRemoteLines: string[] = [];
  let conflictBaseLines: string[] = [];
  let conflictIdCounter = 0;

  for (let i = 0; i < maxLen; i++) {
    const lLine = localLines[i] ?? '';
    const rLine = remoteLines[i] ?? '';
    const bLine = baseLines[i] ?? '';

    const linesDiffer = lLine !== rLine;
    const localChanged = lLine !== bLine;
    const remoteChanged = rLine !== bLine;
    const bothChanged = localChanged && remoteChanged;

    if (linesDiffer && (bothChanged || (localChanged || remoteChanged))) {
      if (!inConflict) {
        inConflict = true;
        conflictStart = i;
        conflictLocalLines = [];
        conflictRemoteLines = [];
        conflictBaseLines = [];
      }
      conflictLocalLines.push(lLine);
      conflictRemoteLines.push(rLine);
      conflictBaseLines.push(bLine);
    } else {
      if (inConflict) {
        conflicts.push({
          id: `conflict-${conflictIdCounter++}`,
          start: conflictStart,
          end: i - 1,
          localContent: conflictLocalLines.join('\n'),
          remoteContent: conflictRemoteLines.join('\n'),
          baseContent: conflictBaseLines.join('\n'),
        });
        inConflict = false;
      }
    }
  }

  if (inConflict) {
    conflicts.push({
      id: `conflict-${conflictIdCounter++}`,
      start: conflictStart,
      end: maxLen - 1,
      localContent: conflictLocalLines.join('\n'),
      remoteContent: conflictRemoteLines.join('\n'),
      baseContent: conflictBaseLines.join('\n'),
    });
  }

  if (conflicts.length === 0 && local !== remote) {
    conflicts.push({
      id: 'conflict-0',
      start: 0,
      end: maxLen - 1,
      localContent: local,
      remoteContent: remote,
      baseContent: base,
    });
  }

  return conflicts;
};

const ConflictResolver: React.FC<ConflictResolverProps> = ({
  open,
  onClose,
  baseContent,
  localContent,
  remoteContent,
  localAuthor = '你',
  remoteAuthor = '其他用户',
  docTitle,
  onResolve,
}) => {
  const { message } = App.useApp();
  const [conflicts, setConflicts] = useState<ConflictBlock[]>([]);
  const [currentConflictIdx, setCurrentConflictIdx] = useState(0);
  const [mergeText, setMergeText] = useState('');
  const mergeTextRef = useRef<HTMLTextAreaElement | null>(null);
  const [resolveMode, setResolveMode] = useState<'guided' | 'free'>('guided');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const detected = detectConflicts(localContent, remoteContent, baseContent);
      setConflicts(detected);
      setCurrentConflictIdx(0);
      setMergeText(localContent);
    }
  }, [open, localContent, remoteContent, baseContent]);

  const currentConflict = conflicts[currentConflictIdx];

  const allResolved = useMemo(() => {
    return conflicts.length > 0 && conflicts.every(c => c.resolved !== undefined);
  }, [conflicts]);

  const unresolvedCount = useMemo(
    () => conflicts.filter(c => !c.resolved).length,
    [conflicts],
  );

  const handleUseLocal = (conflictId: string) => {
    setConflicts(prev =>
      prev.map(c => (c.id === conflictId ? { ...c, resolved: 'local' } : c)),
    );
    const idx = conflicts.findIndex(c => c.id === conflictId);
    if (idx >= 0) {
      updateMergedText(conflictId, conflicts[idx].localContent);
    }
    if (currentConflictIdx < conflicts.length - 1) {
      setTimeout(() => setCurrentConflictIdx(i => i + 1), 200);
    }
  };

  const handleUseRemote = (conflictId: string) => {
    setConflicts(prev =>
      prev.map(c => (c.id === conflictId ? { ...c, resolved: 'remote' } : c)),
    );
    const idx = conflicts.findIndex(c => c.id === conflictId);
    if (idx >= 0) {
      updateMergedText(conflictId, conflicts[idx].remoteContent);
    }
    if (currentConflictIdx < conflicts.length - 1) {
      setTimeout(() => setCurrentConflictIdx(i => i + 1), 200);
    }
  };

  const handleManual = (conflictId: string) => {
    setConflicts(prev =>
      prev.map(c =>
        c.id === conflictId
          ? { ...c, resolved: 'manual', manualContent: c.localContent }
          : c,
      ),
    );
    setResolveMode('free');
  };

  const updateMergedText = (conflictId: string, newContent: string) => {
    const conflict = conflicts.find(c => c.id === conflictId);
    if (!conflict) return;

    const lines = mergeText.split('\n');
    const conflictLen = conflict.end - conflict.start + 1;
    const newLines = newContent.split('\n');

    lines.splice(conflict.start, conflictLen, ...newLines);
    setMergeText(lines.join('\n'));

    const diff = newLines.length - conflictLen;
    if (diff !== 0) {
      setConflicts(prev =>
        prev.map(c => {
          if (c.id === conflictId) {
            return {
              ...c,
              end: c.start + newLines.length - 1,
              manualContent: newContent,
            };
          }
          if (c.start > conflict.end) {
            return {
              ...c,
              start: c.start + diff,
              end: c.end + diff,
            };
          }
          return c;
        }),
      );
    }
  };

  const handleManualEdit = (conflictId: string, content: string) => {
    setConflicts(prev =>
      prev.map(c =>
        c.id === conflictId
          ? { ...c, resolved: 'manual', manualContent: content }
          : c,
      ),
    );
    updateMergedText(conflictId, content);
  };

  const buildMergedContent = (): string => {
    let result = baseContent;
    let offset = 0;
    const baseLines = baseContent.split('\n');
    const sortedConflicts = [...conflicts].sort((a, b) => a.start - b.start);

    for (const c of sortedConflicts) {
      let replacement = '';
      if (c.resolved === 'local') replacement = c.localContent;
      else if (c.resolved === 'remote') replacement = c.remoteContent;
      else if (c.resolved === 'manual') replacement = c.manualContent ?? c.localContent;
      else replacement = c.localContent;

      const start = c.start + offset;
      const conflictLen = c.end - c.start + 1;
      const lines = result.split('\n');
      const newLines = replacement.split('\n');

      const safeStart = Math.max(0, Math.min(start, lines.length));
      const safeLen = Math.max(0, Math.min(conflictLen, lines.length - safeStart));

      lines.splice(safeStart, safeLen, ...newLines);
      result = lines.join('\n');
      offset += newLines.length - safeLen;
    }

    if (resolveMode === 'free') {
      return mergeText;
    }
    return result;
  };

  const handleSubmit = async () => {
    if (!allResolved && resolveMode === 'guided') {
      message.warning(`还有 ${unresolvedCount} 个冲突未解决`);
      return;
    }
    setSubmitting(true);
    try {
      const merged = resolveMode === 'free' ? mergeText : buildMergedContent();
      await onResolve(merged);
      message.success('冲突已解决，文档已合并');
      onClose();
    } catch (e) {
      message.error('合并失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyMerged = async () => {
    const merged = resolveMode === 'free' ? mergeText : buildMergedContent();
    try {
      await navigator.clipboard.writeText(merged);
      message.success('已复制合并结果到剪贴板');
    } catch (e) {
      const textarea = document.createElement('textarea');
      textarea.value = merged;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      message.success('已复制合并结果到剪贴板');
    }
  };

  const renderColoredText = (
    lines: string[],
    side: 'local' | 'remote' | 'base' | 'merged',
    highlightConflictIds: Set<string> = new Set(),
  ) => {
    return lines.map((line, idx) => {
      const conflict = conflicts.find(
        c => idx >= c.start && idx <= c.end,
      );
      const isHighlighted = conflict && highlightConflictIds.has(conflict.id);
      const bgColor = conflict
        ? side === 'local'
          ? '#fff1f0'
          : side === 'remote'
            ? '#e6f4ff'
            : side === 'base'
              ? '#fff7e6'
              : '#f6ffed'
        : 'transparent';
      const borderColor = isHighlighted
        ? side === 'local'
          ? '#ff4d4f'
          : side === 'remote'
            ? '#1677ff'
            : '#faad14'
        : 'transparent';

      return (
        <div
          key={idx}
          style={{
            display: 'flex',
            minHeight: 22,
            borderLeft: conflict ? `3px solid ${borderColor}` : '3px solid transparent',
            backgroundColor: bgColor,
            transition: 'background-color 0.2s',
          }}
        >
          <div
            style={{
              width: 46,
              color: '#bbb',
              textAlign: 'right',
              padding: '2px 6px',
              background: '#fafafa',
              borderRight: '1px solid #f0f0f0',
              flexShrink: 0,
              userSelect: 'none',
              fontSize: 11,
              fontFamily: 'Consolas, monospace',
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
              fontSize: 12,
              fontFamily: 'Consolas, Monaco, monospace',
              color: conflict ? (side === 'base' ? '#d46b08' : '#333') : '#333',
            }}
          >
            {line || ' '}
          </div>
        </div>
      );
    });
  };

  const renderThreeColumnView = () => {
    const localLines = localContent.split('\n');
    const remoteLines = remoteContent.split('\n');
    const baseLines = baseContent.split('\n');
    const maxLines = Math.max(localLines.length, remoteLines.length, baseLines.length);
    const highlightSet = new Set(currentConflict ? [currentConflict.id] : []);

    while (localLines.length < maxLines) localLines.push('');
    while (remoteLines.length < maxLines) remoteLines.push('');
    while (baseLines.length < maxLines) baseLines.push('');

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 1,
          background: '#f0f0f0',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: '#fff2f0',
              borderBottom: '1px solid #ffccc7',
              fontWeight: 500,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              position: 'sticky',
              top: 0,
              zIndex: 1,
            }}
          >
            <LeftOutlined style={{ color: '#ff4d4f' }} />
            <span>本地更改</span>
            <Tag color="red" style={{ marginLeft: 'auto', margin: 0 }}>
              {localAuthor}
            </Tag>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {renderColoredText(localLines, 'local', highlightSet)}
          </div>
        </div>

        <div
          style={{
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: '#fffbe6',
              borderBottom: '1px solid #ffe58f',
              fontWeight: 500,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              position: 'sticky',
              top: 0,
              zIndex: 1,
            }}
          >
            <BulbOutlined style={{ color: '#faad14' }} />
            <span>基础版本</span>
            <Tooltip title="冲突发生前的共同基础版本">
              <Tag color="warning" style={{ marginLeft: 'auto', margin: 0 }}>
                参考
              </Tag>
            </Tooltip>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {renderColoredText(baseLines, 'base', highlightSet)}
          </div>
        </div>

        <div
          style={{
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: '#e6f4ff',
              borderBottom: '1px solid #91caff',
              fontWeight: 500,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              position: 'sticky',
              top: 0,
              zIndex: 1,
            }}
          >
            <span>远程更改</span>
            <RightOutlined style={{ color: '#1677ff' }} />
            <Tag color="blue" style={{ marginLeft: 'auto', margin: 0 }}>
              {remoteAuthor}
            </Tag>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {renderColoredText(remoteLines, 'remote', highlightSet)}
          </div>
        </div>
      </div>
    );
  };

  const renderConflictDetail = () => {
    if (!currentConflict) return null;

    return (
      <div
        style={{
          marginTop: 12,
          border: `2px solid ${currentConflict.resolved ? '#52c41a' : '#faad14'}`,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            background: currentConflict.resolved ? '#f6ffed' : '#fffbe6',
            borderBottom: `1px solid ${currentConflict.resolved ? '#b7eb8f' : '#ffe58f'}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Space size={8}>
            <WarningOutlined style={{ color: currentConflict.resolved ? '#52c41a' : '#faad14' }} />
            <Text strong>
              冲突 #{currentConflictIdx + 1} / {conflicts.length}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              第 {currentConflict.start + 1} - {currentConflict.end + 1} 行
            </Text>
            {currentConflict.resolved && (
              <Tag color="success" icon={<CheckOutlined />}>
                {currentConflict.resolved === 'local'
                  ? '已采用本地'
                  : currentConflict.resolved === 'remote'
                    ? '已采用远程'
                    : '已手动合并'}
              </Tag>
            )}
          </Space>

          <Space size="small" wrap>
            <Tooltip title="使用本地版本的更改">
              <Button
                size="small"
                type={currentConflict.resolved === 'local' ? 'primary' : 'default'}
                danger
                icon={<LeftOutlined />}
                onClick={() => handleUseLocal(currentConflict.id)}
              >
                采用本地版本
              </Button>
            </Tooltip>
            <Tooltip title="使用远程版本的更改">
              <Button
                size="small"
                type={currentConflict.resolved === 'remote' ? 'primary' : 'default'}
                icon={<RightOutlined />}
                onClick={() => handleUseRemote(currentConflict.id)}
              >
                采用远程版本
              </Button>
            </Tooltip>
            <Tooltip title="手动编辑合并内容">
              <Button
                size="small"
                type={currentConflict.resolved === 'manual' ? 'primary' : 'default'}
                icon={<EditOutlined />}
                onClick={() => handleManual(currentConflict.id)}
              >
                手动合并
              </Button>
            </Tooltip>
          </Space>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <div style={{ padding: 12, background: '#fff' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <Space size={4}>
                <Tag color="red" style={{ margin: 0 }}>本地</Tag>
                <Text strong style={{ fontSize: 12 }}>
                  {localAuthor}的更改
                </Text>
              </Space>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard?.writeText(currentConflict.localContent);
                  message.success('已复制本地内容');
                }}
              />
            </div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                background: '#fff1f0',
                borderRadius: 4,
                border: '1px solid #ffccc7',
                fontFamily: 'Consolas, Monaco, monospace',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 150,
                overflowY: 'auto',
              }}
            >
              {currentConflict.localContent || '(空)'}
            </pre>
          </div>

          <div style={{ padding: 12, background: '#fff' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <Space size={4}>
                <Tag color="blue" style={{ margin: 0 }}>远程</Tag>
                <Text strong style={{ fontSize: 12 }}>
                  {remoteAuthor}的更改
                </Text>
              </Space>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard?.writeText(currentConflict.remoteContent);
                  message.success('已复制远程内容');
                }}
              />
            </div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                background: '#e6f4ff',
                borderRadius: 4,
                border: '1px solid #91caff',
                fontFamily: 'Consolas, Monaco, monospace',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 150,
                overflowY: 'auto',
              }}
            >
              {currentConflict.remoteContent || '(空)'}
            </pre>
          </div>
        </div>

        {currentConflict.resolved === 'manual' && (
          <div style={{ padding: 12, borderTop: '1px solid #f0f0f0', background: '#f9f9f9' }}>
            <div style={{ marginBottom: 6 }}>
              <Text strong style={{ fontSize: 12 }}>
                手动合并内容：
              </Text>
            </div>
            <TextArea
              value={currentConflict.manualContent ?? currentConflict.localContent}
              onChange={(e) => handleManualEdit(currentConflict.id, e.target.value)}
              autoSize={{ minRows: 3, maxRows: 10 }}
              style={{
                fontFamily: 'Consolas, Monaco, monospace',
                fontSize: 12,
              }}
            />
          </div>
        )}
      </div>
    );
  };

  const renderConflictNav = () => {
    if (conflicts.length === 0) return null;

    return (
      <div style={{ marginTop: 12 }}>
        <Space wrap size={6}>
          {conflicts.map((c, idx) => {
            const isActive = idx === currentConflictIdx;
            const isResolved = c.resolved !== undefined;
            return (
              <Button
                key={c.id}
                size="small"
                type={isActive ? 'primary' : 'default'}
                onClick={() => setCurrentConflictIdx(idx)}
                style={{
                  minWidth: 40,
                  background: isResolved && !isActive ? '#f6ffed' : undefined,
                  borderColor: isResolved ? '#52c41a' : undefined,
                  color: isResolved && !isActive ? '#389e0d' : undefined,
                }}
              >
                {isResolved ? <CheckOutlined /> : `${idx + 1}`}
              </Button>
            );
          })}
        </Space>
      </div>
    );
  };

  return (
    <Modal
      title={
        <Space>
          <SyncOutlined spin style={{ color: '#faad14' }} />
          <span>文档冲突解决</span>
          {docTitle && <Tag color="default">{docTitle}</Tag>}
          {conflicts.length > 0 && (
            <Tag color={unresolvedCount === 0 ? 'success' : 'warning'}>
              {unresolvedCount === 0 ? '全部已解决' : `${unresolvedCount} 个待解决`}
            </Tag>
          )}
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={1100}
      destroyOnClose
      maskClosable={false}
      footer={
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Radio.Group
              value={resolveMode}
              onChange={(e) => setResolveMode(e.target.value)}
              size="small"
            >
              <Radio.Button value="guided">
                <Space size={4}>
                  <BulbOutlined />
                  引导式解决
                </Space>
              </Radio.Button>
              <Radio.Button value="free">
                <Space size={4}>
                  <EditOutlined />
                  自由编辑
                </Space>
              </Radio.Button>
            </Radio.Group>
            <Button icon={<CopyOutlined />} onClick={handleCopyMerged} size="small">
              复制合并结果
            </Button>
          </Space>
          <Space>
            <Button onClick={onClose} icon={<CloseOutlined />}>
              取消
            </Button>
            <Button
              type="primary"
              loading={submitting}
              onClick={handleSubmit}
              icon={<CheckOutlined />}
              disabled={resolveMode === 'guided' && !allResolved}
            >
              {resolveMode === 'guided' && !allResolved
                ? `还有 ${unresolvedCount} 个冲突`
                : '确认合并'}
            </Button>
          </Space>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {conflicts.length === 0 ? (
          <div style={{ padding: 40 }}>
            <Alert
              type="success"
              showIcon
              message="未检测到冲突"
              description="本地与远程版本可自动合并，可直接确认或手动编辑调整。"
              style={{ marginBottom: 16 }}
            />
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Space direction="vertical">
                  <span>内容一致，无需合并</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    你可以切换到"自由编辑"模式查看或调整内容
                  </Text>
                </Space>
              }
            />
          </div>
        ) : (
          <Alert
            type="warning"
            showIcon
            message={`检测到 ${conflicts.length} 处冲突`}
            description="请逐一审查冲突并选择保留本地、远程版本，或手动合并内容。黄色高亮区域为当前冲突位置。"
          />
        )}

        {resolveMode === 'guided' ? (
          <>
            {renderThreeColumnView()}
            {renderConflictDetail()}
            {renderConflictNav()}

            <Divider style={{ margin: '8px 0' }} />

            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 8,
                  fontWeight: 500,
                }}
              >
                <FileTextOutlined style={{ color: '#52c41a' }} />
                合并结果预览
                {allResolved && (
                  <Tag color="success" icon={<CheckOutlined />}>
                    已全部解决
                  </Tag>
                )}
              </div>
              <div
                style={{
                  border: '1px solid #b7eb8f',
                  borderRadius: 6,
                  overflow: 'hidden',
                  maxHeight: 300,
                  overflowY: 'auto',
                  fontFamily: 'Consolas, Monaco, monospace',
                  fontSize: 12,
                }}
              >
                {renderColoredText(
                  buildMergedContent().split('\n'),
                  'merged',
                  new Set(conflicts.filter(c => c.resolved).map(c => c.id)),
                )}
              </div>
            </div>
          </>
        ) : (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <Space size={6}>
                <EditOutlined style={{ color: '#1677ff' }} />
                <Text strong>自由编辑模式</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  直接编辑合并后的完整文档
                </Text>
              </Space>
              <Space size={4}>
                <Button
                  size="small"
                  onClick={() => setMergeText(localContent)}
                  icon={<LeftOutlined />}
                >
                  重置为本地
                </Button>
                <Button
                  size="small"
                  onClick={() => setMergeText(remoteContent)}
                  icon={<RightOutlined />}
                >
                  重置为远程
                </Button>
              </Space>
            </div>
            <TextArea
              ref={mergeTextRef}
              value={mergeText}
              onChange={(e) => setMergeText(e.target.value)}
              autoSize={{ minRows: 20, maxRows: 30 }}
              style={{
                fontFamily: 'Consolas, Monaco, monospace',
                fontSize: 12,
                lineHeight: 1.6,
              }}
            />
          </div>
        )}
      </Space>
    </Modal>
  );
};

export default ConflictResolver;
