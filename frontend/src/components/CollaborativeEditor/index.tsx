import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { CRDTDocument, CRDTOperation, CRDTOperationData, CRDTDocumentData } from '@/lib/crdt';
import { collabWs } from '@/services/collabWebSocket';
import { useCollabStore } from '@/store';
import type {
  PresenceData,
  CollabSessionState,
} from '@/types';

type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';
type PermissionRole = 'owner' | 'editor' | 'commenter' | 'viewer';

interface UserInfo {
  user_id: string;
  user_name: string;
  user_color?: string;
}

interface CursorData {
  offset: number;
}

interface SelectionData {
  start: number;
  end: number;
}

interface OnlineUser extends UserInfo {
  cursor?: CursorData;
  selection?: SelectionData;
  lastSeen: number;
  avatar?: string;
}

interface LocalOpRecord {
  op: CRDTOperation;
  appliedAt: number;
}

interface ConflictData {
  local_ops_count: number;
  remote_ops_count: number;
  remote_text?: string;
  base_text?: string;
}

const EDITOR_FONT_FAMILY = 'Consolas, Monaco, monospace';
const EDITOR_FONT_SIZE = 14;
const EDITOR_LINE_HEIGHT = 1.6;
const EDITOR_PADDING = 12;

const COMMON_EDITOR_STYLE: React.CSSProperties = {
  fontFamily: EDITOR_FONT_FAMILY,
  fontSize: EDITOR_FONT_SIZE,
  lineHeight: `${EDITOR_LINE_HEIGHT}`,
  padding: `${EDITOR_PADDING}px`,
  boxSizing: 'border-box',
  wordWrap: 'break-word',
  whiteSpace: 'pre-wrap',
  tabSize: 4,
};

const hexToRgba = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const generateUserColor = (userId: string): string => {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8B500', '#FF69B4', '#00CED1', '#32CD32', '#FF8C00',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

interface CollaborativeEditorProps {
  docId: string;
  initialText?: string;
  userId: string;
  userName: string;
  userColor?: string;
  role?: PermissionRole;
  height?: number | string;
  onSave?: (text: string) => void;
  onHistoryClick?: () => void;
  onChatToggle?: () => void;
  onPermissionClick?: () => void;
  onMentionUser?: (user: UserInfo) => void;
}

const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({
  docId,
  initialText = '',
  userId,
  userName,
  userColor: propUserColor,
  role: propRole,
  height = 600,
  onSave,
  onHistoryClick,
  onChatToggle,
  onPermissionClick,
  onMentionUser,
}) => {
  const collabStore = useCollabStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorPreRef = useRef<HTMLPreElement>(null);
  const mirrorSpanRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const crdtDocRef = useRef<CRDTDocument | null>(null);
  const localOpsRef = useRef<LocalOpRecord[]>([]);
  const localOpsOffsetRef = useRef<number>(0);
  const offlineQueueRef = useRef<CRDTOperation[]>([]);
  const pendingRemoteOpsRef = useRef<CRDTOperation[]>([]);
  const isApplyingRemoteRef = useRef<boolean>(false);
  const lastAppliedSiteCounterRef = useRef<Map<string, number>>(new Map());
  const cleanupFnsRef = useRef<Array<() => void>>([]);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    collabWs.isOpen ? 'connected' : 'disconnected'
  );
  const [onlineUsers, setOnlineUsers] = useState<Map<string, OnlineUser>>(new Map());
  const [showConflict, setShowConflict] = useState<boolean>(false);
  const [conflictData, setConflictData] = useState<ConflictData | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [sessionPermission, setSessionPermission] = useState<PermissionRole | null>(null);

  const userColor = useMemo(
    () => propUserColor || collabStore.currentUserColor || generateUserColor(userId),
    [propUserColor, collabStore.currentUserColor, userId]
  );

  const effectiveRole: PermissionRole = propRole ?? sessionPermission ?? 'editor';
  const canEdit = useMemo(
    () => effectiveRole === 'owner' || effectiveRole === 'editor',
    [effectiveRole]
  );
  const canComment = useMemo(() => effectiveRole !== 'viewer', [effectiveRole]);

  const initCRDT = useCallback(() => {
    const doc = new CRDTDocument(docId);
    doc.setSiteId(userId);
    if (initialText && initialText.length > 0) {
      doc.loadFromText(initialText, userId, userId, userName);
    }
    crdtDocRef.current = doc;
    localOpsRef.current = [];
    localOpsOffsetRef.current = 0;
    offlineQueueRef.current = [];
    pendingRemoteOpsRef.current = [];
    if (textareaRef.current) {
      textareaRef.current.value = doc.getText();
    }
  }, [docId, initialText, userId, userName]);

  const getLineColFromIndex = useCallback(
    (text: string, index: number): { line: number; col: number } => {
      const before = text.substring(0, index);
      const lines = before.split('\n');
      return {
        line: lines.length - 1,
        col: lines[lines.length - 1].length,
      };
    },
    []
  );

  const getIndexFromLineCol = useCallback(
    (text: string, line: number, col: number): number => {
      const lines = text.split('\n');
      let idx = 0;
      for (let i = 0; i < line && i < lines.length; i++) {
        idx += lines[i].length + 1;
      }
      if (line < lines.length) {
        idx += Math.min(col, lines[line].length);
      }
      return idx;
    },
    []
  );

  const measurePixelPosition = useCallback(
    (line: number, col: number): { top: number; left: number } => {
      if (!mirrorPreRef.current || !mirrorSpanRef.current) {
        return { top: 0, left: 0 };
      }

      const pre = mirrorPreRef.current;
      const span = mirrorSpanRef.current;

      const textarea = textareaRef.current;
      if (!textarea) return { top: 0, left: 0 };

      const fullText = textarea.value;
      const lines = fullText.split('\n');
      const targetLine = lines[line] ?? '';
      const beforeText = lines.slice(0, line).join('\n') + (line > 0 ? '\n' : '');
      const colText = targetLine.substring(0, col);

      span.textContent = beforeText + colText;
      const rect = span.getBoundingClientRect();
      const preRect = pre.getBoundingClientRect();

      const lineHeightPx = EDITOR_FONT_SIZE * EDITOR_LINE_HEIGHT;

      return {
        top: line * lineHeightPx,
        left: Math.max(0, rect.right - preRect.left),
      };
    },
    []
  );

  const measureSelectionRect = useCallback(
    (
      startLine: number,
      startCol: number,
      endLine: number,
      endCol: number
    ): Array<{ top: number; left: number; width: number; height: number }> => {
      const lineHeightPx = EDITOR_FONT_SIZE * EDITOR_LINE_HEIGHT;
      const rects: Array<{ top: number; left: number; width: number; height: number }> = [];

      const textarea = textareaRef.current;
      if (!textarea) return rects;
      const fullText = textarea.value;
      const lines = fullText.split('\n');

      for (let ln = startLine; ln <= endLine; ln++) {
        const lineText = lines[ln] ?? '';
        const cStart = ln === startLine ? startCol : 0;
        const cEnd = ln === endLine ? endCol : lineText.length;

        const startPos = measurePixelPosition(ln, cStart);
        const endPos = measurePixelPosition(ln, cEnd);

        rects.push({
          top: ln * lineHeightPx,
          left: startPos.left,
          width: Math.max(endPos.left - startPos.left, 2),
          height: lineHeightPx,
        });
      }

      return rects;
    },
    [measurePixelPosition]
  );

  const broadcastOperation = useCallback((op: CRDTOperation) => {
    if (collabWs.isOpen) {
      collabWs.sendOperation(op.toDict());
    } else {
      offlineQueueRef.current.push(op);
    }
  }, []);

  const forceRerenderOverlay = useCallback(() => {
    setOnlineUsers(prev => new Map(prev));
  }, []);

  const getVisibleIndexOfLocalOp = (doc: CRDTDocument, op: CRDTOperation): number => {
    let count = 0;
    for (const c of doc.chars) {
      if (c.position.equals(op.char.position)) return count;
      if (c.visible) count += 1;
    }
    return -1;
  };

  const applyRemoteOperation = useCallback((op: CRDTOperation) => {
    const doc = crdtDocRef.current;
    const textarea = textareaRef.current;
    if (!doc || !textarea) return;

    const siteKey = op.site;
    const prevCounter = lastAppliedSiteCounterRef.current.get(siteKey) ?? -1;
    if (op.char.position.counter <= prevCounter && op.site === doc.siteId) {
      return;
    }

    const selStartBefore = textarea.selectionStart;
    const selEndBefore = textarea.selectionEnd;

    isApplyingRemoteRef.current = true;

    const [applied, visibleIdx, char] = doc.applyOperation(op);

    if (applied) {
      if (op.site === doc.siteId) {
        let foundLocalIdx = -1;
        for (let i = 0; i < localOpsRef.current.length; i++) {
          const localOp = localOpsRef.current[i];
          if (
            localOp.op.type === op.type &&
            localOp.op.char.position.equals(op.char.position) &&
            localOp.op.char.char === op.char.char
          ) {
            foundLocalIdx = i;
            break;
          }
        }
        if (foundLocalIdx >= 0) {
          localOpsRef.current.splice(foundLocalIdx, 1);
        }
      }

      const newText = doc.getText();
      let selOffset = 0;

      if (op.type === 'insert' && char) {
        if (visibleIdx < selStartBefore) {
          selOffset = char.length;
        } else if (visibleIdx >= selStartBefore && visibleIdx < selEndBefore) {
          selOffset = char.length;
        }
      } else if (op.type === 'delete') {
        if (visibleIdx < selStartBefore) {
          selOffset = -1;
        } else if (visibleIdx >= selStartBefore && visibleIdx < selEndBefore) {
          selOffset = -1;
        }
      }

      textarea.value = newText;

      let newSelStart = selStartBefore + selOffset;
      let newSelEnd = selEndBefore + selOffset;

      newSelStart = Math.max(0, Math.min(newSelStart, newText.length));
      newSelEnd = Math.max(0, Math.min(newSelEnd, newText.length));

      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newSelStart;
          textareaRef.current.selectionEnd = newSelEnd;
        }
      });

      forceRerenderOverlay();
    }

    isApplyingRemoteRef.current = false;

    if (applied) {
      const newCounter = Math.max(prevCounter, op.char.position.counter);
      lastAppliedSiteCounterRef.current.set(siteKey, newCounter);
    }
  }, [forceRerenderOverlay]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!canEdit) return;
      if (isApplyingRemoteRef.current) return;

      const doc = crdtDocRef.current;
      if (!doc) return;

      const textarea = e.target;
      const newText = textarea.value;
      const oldText = doc.getText();

      if (newText === oldText) return;

      let i = 0;
      const minLen = Math.min(oldText.length, newText.length);
      while (i < minLen && oldText[i] === newText[i]) {
        i++;
      }

      let oldEnd = oldText.length;
      let newEnd = newText.length;
      while (oldEnd > i && newEnd > i && oldText[oldEnd - 1] === newText[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }

      const deleteCount = oldEnd - i;
      for (let d = deleteCount - 1; d >= 0; d--) {
        const op = doc.delete(i + d, userId, userId, userName);
        if (op) {
          localOpsRef.current.push({ op, appliedAt: Date.now() });
          localOpsOffsetRef.current += 1;
          broadcastOperation(op);
        }
      }

      const insertStr = newText.substring(i, newEnd);
      for (let c = 0; c < insertStr.length; c++) {
        const op = doc.insert(i + c, insertStr[c], userId, userId, userName);
        localOpsRef.current.push({ op, appliedAt: Date.now() });
        localOpsOffsetRef.current += 1;
        broadcastOperation(op);
      }

      textarea.value = doc.getText();
    },
    [canEdit, userId, userName, broadcastOperation]
  );

  const sendCursorPosition = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;

    collabWs.sendCursor(selStart);
    collabWs.sendSelection(selStart, selEnd);
  }, []);

  const handleScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const overlay = overlayRef.current;
    const mirror = mirrorPreRef.current;
    if (!textarea || !overlay || !mirror) return;
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  }, []);

  const handleConnect = useCallback(() => {
    setConnectionStatus('connected');
    const queue = [...offlineQueueRef.current];
    offlineQueueRef.current = [];
    queue.forEach(op => {
      collabWs.sendOperation(op.toDict());
    });

    if (pendingRemoteOpsRef.current.length > 0) {
      const ops = [...pendingRemoteOpsRef.current];
      pendingRemoteOpsRef.current = [];
      ops.forEach(op => applyRemoteOperation(op));
    }
  }, [applyRemoteOperation]);

  const handleDisconnect = useCallback(() => {
    setConnectionStatus('reconnecting');
  }, []);

  const handleReconnecting = useCallback(() => {
    setConnectionStatus('reconnecting');
  }, []);

  const handleSessionState = useCallback(
    (session: CollabSessionState) => {
      if (session.doc_id !== docId) return;

      const docData = session.document as CRDTDocumentData;
      if (docData) {
        const newDoc = CRDTDocument.fromDict(docData);
        crdtDocRef.current = newDoc;
        if (textareaRef.current) {
          textareaRef.current.value = session.text ?? newDoc.getText();
        }
      }

      if (session.permission) {
        setSessionPermission(session.permission);
      }

      if (session.online_users) {
        const usersMap = new Map<string, OnlineUser>();
        session.online_users.forEach(u => {
          if (u.user_id !== userId) {
            usersMap.set(u.user_id, {
              user_id: u.user_id,
              user_name: u.user_name,
              user_color: u.user_color,
              cursor: u.cursor ? { offset: u.cursor.offset } : undefined,
              selection: u.selection ? { start: u.selection.start, end: u.selection.end } : undefined,
              lastSeen: Date.now(),
            });
          }
        });
        setOnlineUsers(usersMap);
      }
    },
    [docId, userId]
  );

  const handleRemoteOperation = useCallback(
    (payload: { op: CRDTOperationData; origin_user_id: string }) => {
      const op = CRDTOperation.fromDict(payload.op);
      if (op.user_id === userId && op.site === (crdtDocRef.current?.siteId ?? '')) {
        return;
      }
      if (collabWs.isOpen) {
        applyRemoteOperation(op);
      } else {
        pendingRemoteOpsRef.current.push(op);
      }
    },
    [userId, applyRemoteOperation]
  );

  const handleOperationsBatch = useCallback(
    (payload: { ops: CRDTOperationData[]; latest_op_timestamp: string }) => {
      const opsData = payload.ops;
      const doc = crdtDocRef.current;
      if (!doc) return;
      const textarea = textareaRef.current;
      if (!textarea) return;

      const selStartBefore = textarea.selectionStart;
      const selEndBefore = textarea.selectionEnd;
      let selOffset = 0;

      isApplyingRemoteRef.current = true;

      for (const opData of opsData) {
        const op = CRDTOperation.fromDict(opData);
        if (op.user_id === userId && op.site === doc.siteId) continue;

        const [applied, visibleIdx, char] = doc.applyOperation(op);
        if (!applied) continue;

        if (op.type === 'insert' && char) {
          if (visibleIdx < selStartBefore) {
            selOffset += char.length;
          } else if (visibleIdx >= selStartBefore && visibleIdx < selEndBefore) {
            selOffset += char.length;
          }
        } else if (op.type === 'delete') {
          if (visibleIdx < selStartBefore) {
            selOffset -= 1;
          } else if (visibleIdx >= selStartBefore && visibleIdx < selEndBefore) {
            selOffset -= 1;
          }
        }
      }

      const newText = doc.getText();
      textarea.value = newText;

      let newSelStart = selStartBefore + selOffset;
      let newSelEnd = selEndBefore + selOffset;
      newSelStart = Math.max(0, Math.min(newSelStart, newText.length));
      newSelEnd = Math.max(0, Math.min(newSelEnd, newText.length));

      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newSelStart;
          textareaRef.current.selectionEnd = newSelEnd;
        }
      });

      isApplyingRemoteRef.current = false;
      forceRerenderOverlay();
    },
    [userId, forceRerenderOverlay]
  );

  const handlePresence = useCallback(
    (presence: PresenceData) => {
      if (presence.user_id === userId) return;
      setOnlineUsers(prev => {
        const next = new Map(prev);
        const user = next.get(presence.user_id) || {
          user_id: presence.user_id,
          user_name: presence.user_name,
          user_color: presence.user_color || generateUserColor(presence.user_id),
          lastSeen: Date.now(),
        };
        if (presence.cursor) {
          user.cursor = { offset: presence.cursor.offset };
        }
        if (presence.selection) {
          user.selection = { start: presence.selection.start, end: presence.selection.end };
        }
        user.user_color = presence.user_color || user.user_color;
        user.lastSeen = Date.now();
        next.set(presence.user_id, user);
        return next;
      });
    },
    [userId]
  );

  const handleUserJoined = useCallback((presence: PresenceData) => {
    setOnlineUsers(prev => {
      const next = new Map(prev);
      next.set(presence.user_id, {
        user_id: presence.user_id,
        user_name: presence.user_name,
        user_color: presence.user_color || generateUserColor(presence.user_id),
        lastSeen: Date.now(),
      });
      return next;
    });
  }, []);

  const handleUserLeft = useCallback((data: { user_id: string }) => {
    setOnlineUsers(prev => {
      const next = new Map(prev);
      next.delete(data.user_id);
      return next;
    });
  }, []);

  const handleWSError = useCallback((err: { message: string; code?: number }) => {
    console.error('[CollaborativeEditor] WS error:', err);
    if (err.code === 409) {
      setConflictData({
        local_ops_count: offlineQueueRef.current.length,
        remote_ops_count: 1,
        remote_text: '',
      });
      setShowConflict(true);
    }
  }, []);

  useEffect(() => {
    initCRDT();

    cleanupFnsRef.current.forEach(fn => {
      try {
        fn();
      } catch (e) {
        console.warn(e);
      }
    });
    cleanupFnsRef.current = [];

    cleanupFnsRef.current.push(collabWs.on('connected', handleConnect));
    cleanupFnsRef.current.push(collabWs.on('disconnected', handleDisconnect));
    cleanupFnsRef.current.push(collabWs.on('reconnecting', handleReconnecting));
    cleanupFnsRef.current.push(collabWs.on('session_state', handleSessionState));
    cleanupFnsRef.current.push(collabWs.on('operation', handleRemoteOperation));
    cleanupFnsRef.current.push(collabWs.on('operations_batch', handleOperationsBatch));
    cleanupFnsRef.current.push(collabWs.on('presence', handlePresence));
    cleanupFnsRef.current.push(collabWs.on('user_joined', handleUserJoined));
    cleanupFnsRef.current.push(collabWs.on('user_left', handleUserLeft));
    cleanupFnsRef.current.push(collabWs.on('error', handleWSError));

    collabWs.connect(docId, userId);

    return () => {
      cleanupFnsRef.current.forEach(fn => {
        try {
          fn();
        } catch (e) {
          console.warn(e);
        }
      });
      cleanupFnsRef.current = [];
      collabWs.disconnect();
    };
  }, [
    docId,
    userId,
    initCRDT,
    handleConnect,
    handleDisconnect,
    handleReconnecting,
    handleSessionState,
    handleRemoteOperation,
    handleOperationsBatch,
    handlePresence,
    handleUserJoined,
    handleUserLeft,
    handleWSError,
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setOnlineUsers(prev => {
        const next = new Map(prev);
        for (const [uid, user] of next) {
          if (now - user.lastSeen > 120000) {
            next.delete(uid);
          }
        }
        return next;
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (connectionStatus === 'reconnecting') {
        setConnectionStatus('disconnected');
      }
    }, 10000);
    return () => clearTimeout(timeout);
  }, [connectionStatus]);

  const handleSave = useCallback(() => {
    const text = crdtDocRef.current?.getText() ?? '';
    onSave?.(text);
  }, [onSave]);

  const handleResolveConflict = useCallback(
    (choice: 'local' | 'remote' | 'merge') => {
      setShowConflict(false);
      if (!conflictData) return;

      if (choice === 'local' && textareaRef.current) {
        const doc = crdtDocRef.current;
        if (doc) {
          offlineQueueRef.current.forEach(op => {
            doc.applyOperation(op);
          });
          textareaRef.current.value = doc.getText();
        }
      } else if (choice === 'remote' && conflictData.remote_text != null) {
        const doc = new CRDTDocument(docId);
        doc.setSiteId(userId);
        doc.loadFromText(conflictData.remote_text, userId, userId, userName);
        crdtDocRef.current = doc;
        if (textareaRef.current) {
          textareaRef.current.value = doc.getText();
        }
      } else if (choice === 'merge') {
        collabWs.sendSyncRequest(new Date().toISOString());
      }

      setConflictData(null);
      offlineQueueRef.current = [];
    },
    [conflictData, docId, userId, userName]
  );

  const statusConfig = {
    connected: { color: '#22c55e', text: '已连接', bg: '#dcfce7' },
    reconnecting: { color: '#eab308', text: '重连中...', bg: '#fef9c3' },
    disconnected: { color: '#ef4444', text: '离线', bg: '#fee2e2' },
  };

  const roleLabel: Record<PermissionRole, string> = {
    owner: '所有者',
    editor: '编辑者',
    commenter: '评论者',
    viewer: '查看者',
  };

  const roleColor: Record<PermissionRole, string> = {
    owner: '#7c3aed',
    editor: '#2563eb',
    commenter: '#059669',
    viewer: '#6b7280',
  };

  const renderRemoteCursors = () => {
    const elements: React.ReactNode[] = [];
    const textarea = textareaRef.current;
    if (!textarea) return elements;
    const fullText = textarea.value;

    onlineUsers.forEach((user, uid) => {
      const color = user.user_color || generateUserColor(uid);

      if (user.selection && user.selection.start !== user.selection.end) {
        const start = Math.min(user.selection.start, user.selection.end);
        const end = Math.max(user.selection.start, user.selection.end);
        const startPos = getLineColFromIndex(fullText, start);
        const endPos = getLineColFromIndex(fullText, end);

        const rects = measureSelectionRect(
          startPos.line,
          startPos.col,
          endPos.line,
          endPos.col
        );
        rects.forEach((rect, idx) => {
          elements.push(
            <div
              key={`sel-${uid}-${idx}`}
              style={{
                position: 'absolute',
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                backgroundColor: hexToRgba(color, 0.25),
                pointerEvents: 'none',
                borderRadius: 2,
              }}
            />
          );
        });
      }

      if (user.cursor) {
        const cursorOffset: number = user.cursor.offset;
        const cursorPos = getLineColFromIndex(fullText, cursorOffset);
        const pos = measurePixelPosition(cursorPos.line, cursorPos.col);
        elements.push(
          <div
            key={`cursor-${uid}`}
            style={{
              position: 'absolute',
              top: pos.top,
              left: pos.left,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <div
              style={{
                position: 'relative',
                top: -18,
                left: 0,
                backgroundColor: color,
                color: 'white',
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 3,
                whiteSpace: 'nowrap',
                lineHeight: '16px',
                fontWeight: 500,
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            >
              {user.user_name}
            </div>
            <div
              style={{
                width: 2,
                height: EDITOR_FONT_SIZE * EDITOR_LINE_HEIGHT,
                backgroundColor: color,
                animation: 'collab-cursor-blink 1s step-end infinite',
                marginTop: -2,
              }}
            />
          </div>
        );
      }
    });

    return elements;
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: typeof height === 'number' ? `${height}px` : height,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        backgroundColor: 'white',
        overflow: 'hidden',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <style>
        {`
          @keyframes collab-cursor-blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
          }
        `}
      </style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid #f3f4f6',
          backgroundColor: '#fafafa',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              position: 'relative',
            }}
          >
            {Array.from(onlineUsers.values())
              .slice(0, 5)
              .map((user, i) => {
                const color =
                  user.user_color || generateUserColor(user.user_id);
                const zIndex = 50 - i;
                return (
                  <div
                    key={user.user_id}
                    title={`${user.user_name} (点击@提及)`}
                    onClick={() =>
                      onMentionUser?.({
                        user_id: user.user_id,
                        user_name: user.user_name,
                        user_color: user.user_color,
                      })
                    }
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      backgroundColor: color,
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 600,
                      border: '2px solid white',
                      marginLeft: i === 0 ? 0 : -8,
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                      transition: 'transform 0.15s',
                      position: 'relative',
                      zIndex,
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.transform =
                        'scale(1.1) translateY(-2px)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.transform =
                        'scale(1) translateY(0)';
                    }}
                  >
                    {user.user_name.charAt(0).toUpperCase()}
                  </div>
                );
              })}
            <div
              title={`${userName} (你)`}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: userColor,
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 600,
                border: `2px solid ${userColor}`,
                marginLeft: onlineUsers.size > 0 ? -8 : 0,
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                position: 'relative',
                zIndex: 100,
              }}
            >
              {userName.charAt(0).toUpperCase()}
            </div>
            {onlineUsers.size > 0 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: -4,
                  right: -4,
                  backgroundColor: '#22c55e',
                  color: 'white',
                  fontSize: 10,
                  fontWeight: 600,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid white',
                  zIndex: 200,
                }}
              >
                {onlineUsers.size}
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              backgroundColor: statusConfig[connectionStatus].bg,
              borderRadius: 12,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: statusConfig[connectionStatus].color,
                animation:
                  connectionStatus !== 'connected'
                    ? 'collab-cursor-blink 1s step-end infinite'
                    : undefined,
              }}
            />
            <span
              style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}
            >
              {statusConfig[connectionStatus].text}
            </span>
          </div>

          <div
            style={{
              padding: '3px 10px',
              backgroundColor: hexToRgba(roleColor[effectiveRole], 0.1),
              color: roleColor[effectiveRole],
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              border: `1px solid ${hexToRgba(roleColor[effectiveRole], 0.3)}`,
            }}
          >
            {roleLabel[effectiveRole]}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={onHistoryClick}
            title="历史记录"
            style={{
              padding: '6px 10px',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
              color: '#4b5563',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                '#f3f4f6';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                'transparent';
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M12 7v5l4 2" />
            </svg>
            历史
          </button>

          <button
            onClick={() => {
              setSidebarOpen(v => !v);
              onChatToggle?.();
            }}
            title="聊天"
            style={{
              padding: '6px 10px',
              backgroundColor: sidebarOpen ? '#eff6ff' : 'transparent',
              border: 'none',
              borderRadius: 4,
              cursor: canComment ? 'pointer' : 'not-allowed',
              fontSize: 13,
              color: sidebarOpen ? '#2563eb' : '#4b5563',
              opacity: canComment ? 1 : 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            onMouseEnter={e => {
              if (canComment)
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  '#f3f4f6';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                sidebarOpen ? '#eff6ff' : 'transparent';
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            聊天
          </button>

          <button
            onClick={onPermissionClick}
            title="权限管理"
            style={{
              padding: '6px 10px',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 4,
              cursor: effectiveRole === 'owner' ? 'pointer' : 'not-allowed',
              fontSize: 13,
              color: '#4b5563',
              opacity: effectiveRole === 'owner' ? 1 : 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            onMouseEnter={e => {
              if (effectiveRole === 'owner')
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  '#f3f4f6';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                'transparent';
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            权限
          </button>

          <div
            style={{
              width: 1,
              height: 20,
              backgroundColor: '#e5e7eb',
              margin: '0 4px',
            }}
          />

          <button
            onClick={handleSave}
            title="保存文档"
            style={{
              padding: '6px 14px',
              backgroundColor: '#2563eb',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
              color: 'white',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'background-color 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                '#1d4ed8';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                '#2563eb';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            保存
          </button>
        </div>
      </div>

      {connectionStatus !== 'connected' && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: '#fef3c7',
            color: '#92400e',
            fontSize: 13,
            borderBottom: '1px solid #fde68a',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          离线模式 - 操作将在重连后同步（
          {offlineQueueRef.current.length + collabWs.pendingCount} 个操作待发送）
        </div>
      )}

      <div
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          overflow: 'hidden',
        }}
      >
        <pre
          ref={mirrorPreRef}
          aria-hidden="true"
          style={{
            ...COMMON_EDITOR_STYLE,
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            visibility: 'hidden',
            margin: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          <span
            ref={mirrorSpanRef}
            style={{
              display: 'inline',
              visibility: 'hidden',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
            }}
          />
        </pre>

        <textarea
          ref={textareaRef}
          onChange={handleInput}
          onScroll={handleScroll}
          onKeyUp={sendCursorPosition}
          onClick={sendCursorPosition}
          onSelect={sendCursorPosition}
          onBlur={sendCursorPosition}
          readOnly={!canEdit}
          defaultValue={initialText}
          spellCheck={false}
          style={{
            ...COMMON_EDITOR_STYLE,
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            margin: 0,
            border: 'none',
            outline: 'none',
            resize: 'none',
            overflow: 'auto',
            backgroundColor: 'transparent',
            color: canEdit ? '#111827' : '#374151',
            caretColor: canEdit ? '#2563eb' : 'transparent',
            cursor: canEdit ? 'text' : 'default',
            zIndex: 1,
          }}
        />

        <div
          ref={overlayRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'hidden',
            padding: `${EDITOR_PADDING}px`,
            boxSizing: 'border-box',
            zIndex: 2,
          }}
        >
          <div style={{ position: 'relative' }}>{renderRemoteCursors()}</div>
        </div>
      </div>

      {showConflict && conflictData && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: 8,
              padding: 24,
              maxWidth: 600,
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3
              style={{
                margin: '0 0 12px 0',
                fontSize: 18,
                color: '#111827',
              }}
            >
              ⚠️ 检测到同步冲突
            </h3>
            <p
              style={{
                margin: '0 0 16px 0',
                fontSize: 14,
                color: '#6b7280',
              }}
            >
              离线期间发生了无法自动合并的更改，请选择要保留的版本：
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  padding: 12,
                  backgroundColor: '#f3f4f6',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#374151',
                  maxHeight: 80,
                  overflow: 'auto',
                }}
              >
                <strong style={{ color: '#2563eb' }}>
                  本地版本（{conflictData.local_ops_count ?? 0} 个更改）：
                </strong>
                <div
                  style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}
                >
                  {(crdtDocRef.current?.getText() ?? '').substring(0, 200)}
                  {(crdtDocRef.current?.getText() ?? '').length > 200
                    ? '...'
                    : ''}
                </div>
              </div>
              {conflictData.remote_text != null && (
                <div
                  style={{
                    padding: 12,
                    backgroundColor: '#f3f4f6',
                    borderRadius: 6,
                    fontSize: 13,
                    color: '#374151',
                    maxHeight: 80,
                    overflow: 'auto',
                  }}
                >
                  <strong style={{ color: '#059669' }}>
                    远程版本（{conflictData.remote_ops_count ?? 0} 个更改）：
                  </strong>
                  <div
                    style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}
                  >
                    {conflictData.remote_text.substring(0, 200)}
                    {conflictData.remote_text.length > 200 ? '...' : ''}
                  </div>
                </div>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => handleResolveConflict('remote')}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f3f4f6',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                  color: '#374151',
                }}
              >
                使用远程版本
              </button>
              <button
                onClick={() => handleResolveConflict('merge')}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f3f4f6',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                  color: '#374151',
                }}
              >
                手动合并
              </button>
              <button
                onClick={() => handleResolveConflict('local')}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#2563eb',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'white',
                  fontWeight: 500,
                }}
              >
                保留本地版本
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollaborativeEditor;
