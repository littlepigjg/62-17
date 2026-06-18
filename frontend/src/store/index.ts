import { create } from 'zustand';
import type {
  ServerConfig,
  ExecutionResult,
  ScriptTemplate,
  StreamMessage,
  PresenceData,
  ChatMessageData,
  NotificationData,
  HistorySnapshotData,
  CollabSessionState,
  CRDTOperationData,
  CRDTDocumentData,
  PermissionLevel,
} from '../types';
import { CRDTDocument, CRDTOperation } from '../lib/crdt';
import { collabWs, CollabWebSocketService } from '../services/collabWebSocket';

interface TaskOutput {
  taskId: string;
  serverId: string;
  serverName: string;
  stdout: string;
  stderr: string;
  status: string;
  exitCode: number | null;
}

interface AppState {
  servers: ServerConfig[];
  selectedServerIds: string[];
  templates: ScriptTemplate[];
  activeTasks: Map<string, ExecutionResult>;
  taskOutputs: Map<string, TaskOutput>;
  currentTab: string;

  setServers: (servers: ServerConfig[]) => void;
  addServer: (server: ServerConfig) => void;
  updateServer: (server: ServerConfig) => void;
  removeServer: (id: string) => void;
  setSelectedServerIds: (ids: string[]) => void;

  setTemplates: (templates: ScriptTemplate[]) => void;
  addTemplate: (tpl: ScriptTemplate) => void;
  updateTemplate: (tpl: ScriptTemplate) => void;
  removeTemplate: (id: string) => void;

  addActiveTasks: (tasks: ExecutionResult[]) => void;
  updateTask: (task: ExecutionResult) => void;
  handleStreamMessage: (msg: StreamMessage) => void;
  clearTask: (taskId: string) => void;

  setCurrentTab: (tab: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  servers: [],
  selectedServerIds: [],
  templates: [],
  activeTasks: new Map(),
  taskOutputs: new Map(),
  currentTab: 'execute',

  setServers: (servers) => set({ servers }),
  addServer: (server) => set(state => {
    const exists = state.servers.some(s => s.id === server.id);
    return {
      servers: exists
        ? state.servers.map(s => s.id === server.id ? server : s)
        : [...state.servers, server],
    };
  }),
  updateServer: (server) => set(state => ({
    servers: state.servers.map(s => s.id === server.id ? server : s),
  })),
  removeServer: (id) => set(state => ({
    servers: state.servers.filter(s => s.id !== id),
    selectedServerIds: state.selectedServerIds.filter(sid => sid !== id),
  })),
  setSelectedServerIds: (ids) => set({ selectedServerIds: ids }),

  setTemplates: (templates) => set({ templates }),
  addTemplate: (tpl) => set(state => {
    const exists = state.templates.some(t => t.id === tpl.id);
    return {
      templates: exists
        ? state.templates.map(t => t.id === tpl.id ? tpl : t)
        : [tpl, ...state.templates],
    };
  }),
  updateTemplate: (tpl) => set(state => ({
    templates: state.templates.map(t => t.id === tpl.id ? tpl : t),
  })),
  removeTemplate: (id) => set(state => ({
    templates: state.templates.filter(t => t.id !== id),
  })),

  addActiveTasks: (tasks) => set(state => {
    const newActive = new Map(state.activeTasks);
    const newOutputs = new Map(state.taskOutputs);
    tasks.forEach(t => {
      newActive.set(t.task_id, t);
      if (!newOutputs.has(t.task_id)) {
        newOutputs.set(t.task_id, {
          taskId: t.task_id,
          serverId: t.server_id,
          serverName: t.server_name,
          stdout: '',
          stderr: '',
          status: t.status,
          exitCode: null,
        });
      }
    });
    return { activeTasks: newActive, taskOutputs: newOutputs };
  }),
  updateTask: (task) => set(state => {
    const newActive = new Map(state.activeTasks);
    newActive.set(task.task_id, task);
    return { activeTasks: newActive };
  }),
  handleStreamMessage: (msg) => set(state => {
    const outputs = new Map(state.taskOutputs);
    const active = new Map(state.activeTasks);
    const key = msg.task_id;

    const existing = outputs.get(key) || {
      taskId: msg.task_id,
      serverId: msg.server_id,
      serverName: msg.server_name,
      stdout: '',
      stderr: '',
      status: '',
      exitCode: null,
    };

    if (msg.type === 'output') {
      if (msg.stream === 'stdout') {
        existing.stdout += msg.content;
      } else if (msg.stream === 'stderr') {
        existing.stderr += msg.content;
      }
    } else if (msg.type === 'status') {
      existing.status = msg.status;
      existing.exitCode = msg.exit_code;

      const task = active.get(key);
      if (task) {
        task.status = msg.status as any;
        task.exit_code = msg.exit_code;
        active.set(key, { ...task });
      }
    }

    outputs.set(key, { ...existing });
    return { taskOutputs: outputs, activeTasks: active };
  }),
  clearTask: (taskId) => set(state => {
    const outputs = new Map(state.taskOutputs);
    const active = new Map(state.activeTasks);
    outputs.delete(taskId);
    active.delete(taskId);
    return { taskOutputs: outputs, activeTasks: active };
  }),

  setCurrentTab: (tab) => set({ currentTab: tab }),
}));

const USER_ID_KEY = 'collab_user_id';
const USER_NAME_KEY = 'collab_user_name';
const USER_COLOR_KEY = 'collab_user_color';

const USER_COLORS = [
  '#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1',
  '#13c2c2', '#eb2f96', '#fa8c16', '#2f54eb', '#a0d911',
];

const generateRandomUserId = () => 'user_' + Math.random().toString(36).slice(2, 10);
const generateRandomUserName = () => '用户' + Math.floor(Math.random() * 10000);
const generateRandomUserColor = () => USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

const getStoredUserId = () => {
  try {
    const stored = localStorage.getItem(USER_ID_KEY);
    if (stored) return stored;
  } catch {}
  const id = generateRandomUserId();
  try { localStorage.setItem(USER_ID_KEY, id); } catch {}
  return id;
};

interface CollabState {
  currentUserId: string;
  currentUserName: string;
  currentUserColor: string;
  currentDocId: string | null;
  document: CRDTDocument | null;
  text: string;
  onlineUsers: Map<string, PresenceData>;
  chatMessages: ChatMessageData[];
  notifications: NotificationData[];
  unreadNotifCount: number;
  historySnapshots: HistorySnapshotData[];
  permission: PermissionLevel | null;
  isConnected: boolean;
  isCollabMode: boolean;
  conflictState: { localText: string; remoteText: string; baseText: string } | null;
  sidebarOpen: boolean;
  mentionFlash: boolean;
  wsCleanup: (() => void)[];

  setCurrentUser: (id: string, name?: string, color?: string) => void;
  generateUserId: () => string;

  joinDocument: (docId: string, wsCallback?: (ws: CollabWebSocketService) => void) => Promise<void>;
  leaveDocument: () => void;

  applyRemoteOperation: (opData: CRDTOperationData) => boolean;
  insertLocal: (index: number, char: string) => CRDTOperation | null;
  deleteLocal: (index: number) => CRDTOperation | null;

  updatePresence: (presence: Partial<PresenceData>) => void;
  updateUserCursor: (offset: number) => void;
  updateUserSelection: (start: number, end: number) => void;

  addChatMessage: (msg: ChatMessageData) => void;
  sendChat: (content: string) => void;
  setChatHistory: (msgs: ChatMessageData[]) => void;

  addNotification: (notif: NotificationData) => void;
  markNotifRead: (id: string) => void;
  markAllNotifRead: () => void;

  setHistorySnapshots: (snapshots: HistorySnapshotData[]) => void;

  setPermission: (perm: PermissionLevel | null) => void;

  showConflict: (localText: string, remoteText: string, baseText: string) => void;
  resolveConflict: (resolvedText: string, acceptRemote: boolean) => void;

  setSidebarOpen: (open: boolean) => void;
  triggerMentionFlash: () => void;
}

const initUserName = () => {
  try {
    const stored = localStorage.getItem(USER_NAME_KEY);
    if (stored) return stored;
  } catch {}
  const name = generateRandomUserName();
  try { localStorage.setItem(USER_NAME_KEY, name); } catch {}
  return name;
};

const initUserColor = () => {
  try {
    const stored = localStorage.getItem(USER_COLOR_KEY);
    if (stored) return stored;
  } catch {}
  const color = generateRandomUserColor();
  try { localStorage.setItem(USER_COLOR_KEY, color); } catch {}
  return color;
};

export const useCollabStore = create<CollabState>((set, get) => ({
  currentUserId: getStoredUserId(),
  currentUserName: initUserName(),
  currentUserColor: initUserColor(),
  currentDocId: null,
  document: null,
  text: '',
  onlineUsers: new Map(),
  chatMessages: [],
  notifications: [],
  unreadNotifCount: 0,
  historySnapshots: [],
  permission: null,
  isConnected: false,
  isCollabMode: false,
  conflictState: null,
  sidebarOpen: false,
  mentionFlash: false,
  wsCleanup: [],

  setCurrentUser: (id, name, color) => {
    try {
      localStorage.setItem(USER_ID_KEY, id);
      if (name) localStorage.setItem(USER_NAME_KEY, name);
      if (color) localStorage.setItem(USER_COLOR_KEY, color);
    } catch {}
    set(state => ({
      currentUserId: id,
      currentUserName: name ?? state.currentUserName,
      currentUserColor: color ?? state.currentUserColor,
    }));
  },

  generateUserId: () => {
    const id = generateRandomUserId();
    const name = generateRandomUserName();
    const color = generateRandomUserColor();
    get().setCurrentUser(id, name, color);
    return id;
  },

  joinDocument: async (docId, wsCallback) => {
    const state = get();
    state.leaveDocument();

    const document = new CRDTDocument(docId);
    set({
      currentDocId: docId,
      document,
      text: '',
      onlineUsers: new Map(),
      chatMessages: [],
      historySnapshots: [],
      permission: null,
      isCollabMode: true,
      wsCleanup: [],
    });

    const cleanups: (() => void)[] = [];

    cleanups.push(collabWs.on('connected', () => {
      set({ isConnected: true });
    }));

    cleanups.push(collabWs.on('disconnected', () => {
      set({ isConnected: false });
    }));

    cleanups.push(collabWs.on('session_state', (session: CollabSessionState) => {
      const docData = session.document as CRDTDocumentData;
      const newDoc = CRDTDocument.fromDict(docData);
      const usersMap = new Map<string, PresenceData>();
      session.online_users.forEach(u => usersMap.set(u.user_id, u));
      set(state => ({
        document: newDoc,
        text: session.text ?? newDoc.getText(),
        onlineUsers: usersMap,
        permission: session.permission ?? state.permission,
      }));
    }));

    cleanups.push(collabWs.on('operation', (payload: { op: CRDTOperationData; origin_user_id: string }) => {
      get().applyRemoteOperation(payload.op);
    }));

    cleanups.push(collabWs.on('operations_batch', (payload: { ops: CRDTOperationData[]; latest_op_timestamp: string }) => {
      const doc = get().document;
      if (!doc) return;
      for (const opData of payload.ops) {
        const op = CRDTOperation.fromDict(opData);
        doc.applyOperation(op);
      }
      set({ text: doc.getText() });
    }));

    cleanups.push(collabWs.on('presence', (presence: PresenceData) => {
      set(state => {
        const newMap = new Map(state.onlineUsers);
        newMap.set(presence.user_id, presence);
        return { onlineUsers: newMap };
      });
    }));

    cleanups.push(collabWs.on('user_joined', (presence: PresenceData) => {
      set(state => {
        const newMap = new Map(state.onlineUsers);
        newMap.set(presence.user_id, presence);
        return { onlineUsers: newMap };
      });
    }));

    cleanups.push(collabWs.on('user_left', (payload: { user_id: string }) => {
      const { user_id } = payload;
      set(state => {
        const newMap = new Map(state.onlineUsers);
        newMap.delete(user_id);
        return { onlineUsers: newMap };
      });
    }));

    cleanups.push(collabWs.on('chat', (msg: ChatMessageData) => {
      get().addChatMessage(msg);
    }));

    cleanups.push(collabWs.on('chat_history', (msgs: ChatMessageData[]) => {
      get().setChatHistory(msgs);
    }));

    cleanups.push(collabWs.on('notification', (payload: { notification: NotificationData; target_user_id: string }) => {
      get().addNotification(payload.notification);
    }));

    cleanups.push(collabWs.on('error', (err: { message: string; code?: number }) => {
      console.error('[CollabStore] WS error:', err);
    }));

    set({ wsCleanup: cleanups });

    collabWs.connect(docId, get().currentUserId);

    if (wsCallback) {
      wsCallback(collabWs);
    }
  },

  leaveDocument: () => {
    const state = get();
    state.wsCleanup.forEach(fn => {
      try { fn(); } catch (e) { console.warn(e); }
    });
    collabWs.disconnect();
    set({
      currentDocId: null,
      document: null,
      text: '',
      onlineUsers: new Map(),
      chatMessages: [],
      historySnapshots: [],
      permission: null,
      isConnected: false,
      isCollabMode: false,
      conflictState: null,
      wsCleanup: [],
    });
  },

  applyRemoteOperation: (opData: CRDTOperationData) => {
    const doc = get().document;
    if (!doc) return false;
    const op = CRDTOperation.fromDict(opData);
    const [applied] = doc.applyOperation(op);
    if (applied) {
      set({ text: doc.getText() });
    }
    return applied;
  },

  insertLocal: (index, char) => {
    const state = get();
    const doc = state.document;
    if (!doc) return null;
    const op = doc.insert(index, char, doc.siteId, state.currentUserId, state.currentUserName);
    set({ text: doc.getText() });
    collabWs.sendOperation(op.toDict());
    return op;
  },

  deleteLocal: (index) => {
    const state = get();
    const doc = state.document;
    if (!doc) return null;
    const op = doc.delete(index, doc.siteId, state.currentUserId, state.currentUserName);
    if (op) {
      set({ text: doc.getText() });
      collabWs.sendOperation(op.toDict());
    }
    return op;
  },

  updatePresence: (presence) => {
    const state = get();
    const fullPresence: PresenceData = {
      user_id: state.currentUserId,
      user_name: state.currentUserName,
      user_color: state.currentUserColor,
      last_active: new Date().toISOString(),
      ...presence,
    };
    collabWs.sendPresence(fullPresence);
    set(prev => {
      const newMap = new Map(prev.onlineUsers);
      newMap.set(state.currentUserId, fullPresence);
      return { onlineUsers: newMap };
    });
  },

  updateUserCursor: (offset) => {
    get().updatePresence({ cursor: { offset } });
    collabWs.sendCursor(offset);
  },

  updateUserSelection: (start, end) => {
    get().updatePresence({ selection: { start, end } });
    collabWs.sendSelection(start, end);
  },

  addChatMessage: (msg) => {
    set(state => {
      const exists = state.chatMessages.some(m => m.id === msg.id);
      if (exists) return state;
      const containsMention = msg.mentions && msg.mentions.includes(state.currentUserId);
      if (containsMention) {
        setTimeout(() => get().triggerMentionFlash(), 0);
      }
      return { chatMessages: [...state.chatMessages, msg] };
    });
  },

  sendChat: (content) => {
    collabWs.sendChat(content);
    const state = get();
    const msg: ChatMessageData = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      channel_id: state.currentDocId ?? 'default',
      user_id: state.currentUserId,
      user_name: state.currentUserName,
      user_color: state.currentUserColor,
      content,
      timestamp: new Date().toISOString(),
      mentions: [],
      is_system: false,
    };
    get().addChatMessage(msg);
  },

  setChatHistory: (msgs) => {
    set({ chatMessages: msgs });
  },

  addNotification: (notif) => {
    set(state => ({
      notifications: [notif, ...state.notifications],
      unreadNotifCount: notif.read ? state.unreadNotifCount : state.unreadNotifCount + 1,
    }));
  },

  markNotifRead: (id) => {
    set(state => ({
      notifications: state.notifications.map(n =>
        n.id === id ? { ...n, read: true } : n
      ),
      unreadNotifCount: state.notifications.some(n => n.id === id && !n.read)
        ? Math.max(0, state.unreadNotifCount - 1)
        : state.unreadNotifCount,
    }));
  },

  markAllNotifRead: () => {
    set(state => ({
      notifications: state.notifications.map(n => ({ ...n, read: true })),
      unreadNotifCount: 0,
    }));
  },

  setHistorySnapshots: (snapshots) => {
    set({ historySnapshots: snapshots });
  },

  setPermission: (perm) => {
    set({ permission: perm });
  },

  showConflict: (localText, remoteText, baseText) => {
    set({
      conflictState: { localText, remoteText, baseText },
    });
  },

  resolveConflict: (resolvedText, acceptRemote) => {
    const state = get();
    const doc = state.document;
    if (acceptRemote && doc && state.currentDocId) {
      collabWs.sendSyncRequest(new Date().toISOString());
    }
    if (doc) {
      doc.chars = [];
      (doc as any)._counter = 0;
      doc.loadFromText(resolvedText, doc.siteId, state.currentUserId, state.currentUserName);
      set({ text: doc.getText() });
    } else {
      set({ text: resolvedText });
    }
    set({ conflictState: null });
  },

  setSidebarOpen: (open) => {
    set({ sidebarOpen: open });
  },

  triggerMentionFlash: () => {
    set({ mentionFlash: true });
    setTimeout(() => {
      set({ mentionFlash: false });
    }, 300);
  },
}));
