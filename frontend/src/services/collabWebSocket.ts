import type {
  CollabMessageType,
  CRDTOperationData,
  PresenceData,
  ChatMessageData,
  CollabSessionState,
  NotificationData,
} from '../types';

type CollabEvent =
  | 'session_state'
  | 'operation'
  | 'presence'
  | 'user_joined'
  | 'user_left'
  | 'chat'
  | 'chat_history'
  | 'notification'
  | 'operations_batch'
  | 'error'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

type EventPayloadMap = {
  session_state: CollabSessionState;
  operation: { op: CRDTOperationData; origin_user_id: string };
  presence: PresenceData;
  user_joined: PresenceData;
  user_left: { user_id: string };
  chat: ChatMessageData;
  chat_history: ChatMessageData[];
  notification: { notification: NotificationData; target_user_id: string };
  operations_batch: { ops: CRDTOperationData[]; latest_op_timestamp: string };
  error: { message: string; code?: number };
  connected: void;
  disconnected: void;
  reconnecting: { attempt: number; delay: number };
};

type EventHandler<K extends CollabEvent> = (payload: EventPayloadMap[K]) => void;

interface PendingItem {
  type: CollabMessageType;
  payload: unknown;
  timestamp: number;
}

const PENDING_OPS_KEY = 'collab_pending_ops';
const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 30000;

export class CollabWebSocketService {
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private docId: string | null = null;
  private userId: string | null = null;
  private handlers: Map<CollabEvent, Set<EventHandler<any>>> = new Map();
  private pendingQueue: PendingItem[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnect = false;

  constructor() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.baseUrl = `${protocol}//${window.location.host}/ws/collab`;
    this.loadPendingQueue();
  }

  private loadPendingQueue(): void {
    try {
      const raw = localStorage.getItem(PENDING_OPS_KEY);
      if (raw) {
        const data = JSON.parse(raw) as PendingItem[];
        if (Array.isArray(data)) {
          this.pendingQueue = data;
        }
      }
    } catch (e) {
      console.warn('[CollabWS] Failed to load pending queue:', e);
    }
  }

  private savePendingQueue(): void {
    try {
      localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(this.pendingQueue));
    } catch (e) {
      console.warn('[CollabWS] Failed to save pending queue:', e);
    }
  }

  connect(docId: string, userId: string): void {
    this.docId = docId;
    this.userId = userId;
    this.manualDisconnect = false;
    this.reconnectAttempt = 0;
    this.doConnect();
  }

  private doConnect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!this.docId || !this.userId) {
      console.error('[CollabWS] Cannot connect without docId and userId');
      return;
    }

    const url = `${this.baseUrl}?doc_id=${encodeURIComponent(this.docId)}&user_id=${encodeURIComponent(this.userId)}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[CollabWS] Connected');
        this.reconnectAttempt = 0;
        this.emit('connected', undefined as any);
        this.startHeartbeat();
        this.flushPendingQueue();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[CollabWS] Parse error:', e);
        }
      };

      this.ws.onerror = (e) => {
        console.error('[CollabWS] Error:', e);
      };

      this.ws.onclose = (event) => {
        console.log('[CollabWS] Disconnected, code:', event.code);
        this.stopHeartbeat();
        this.emit('disconnected', undefined as any);

        if (!this.manualDisconnect) {
          this.scheduleReconnect();
        }
      };
    } catch (e) {
      console.error('[CollabWS] Connect error:', e);
      if (!this.manualDisconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private handleMessage(msg: { type: CollabMessageType; payload?: unknown }): void {
    switch (msg.type) {
      case 'pong':
        this.handlePong();
        break;
      case 'session_state':
        this.emit('session_state', msg.payload as CollabSessionState);
        break;
      case 'operation':
        this.emit('operation', msg.payload as { op: CRDTOperationData; origin_user_id: string });
        break;
      case 'presence':
        this.emit('presence', msg.payload as PresenceData);
        break;
      case 'user_joined':
        this.emit('user_joined', msg.payload as PresenceData);
        break;
      case 'user_left':
        this.emit('user_left', msg.payload as { user_id: string });
        break;
      case 'chat':
        this.emit('chat', msg.payload as ChatMessageData);
        break;
      case 'chat_history':
        this.emit('chat_history', msg.payload as ChatMessageData[]);
        break;
      case 'notification':
        this.emit('notification', msg.payload as { notification: NotificationData; target_user_id: string });
        break;
      case 'operations_batch':
        this.emit('operations_batch', msg.payload as { ops: CRDTOperationData[]; latest_op_timestamp: string });
        break;
      case 'error':
        this.emit('error', msg.payload as { message: string; code?: number });
        break;
      default:
        console.warn('[CollabWS] Unknown message type:', msg.type);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempt += 1;
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempt - 1),
      MAX_RECONNECT_DELAY,
    );
    const jitter = Math.random() * 1000;
    const totalDelay = delay + jitter;

    console.log(`[CollabWS] Reconnecting in ${Math.round(totalDelay)}ms (attempt ${this.reconnectAttempt})`);
    this.emit('reconnecting', { attempt: this.reconnectAttempt, delay: totalDelay });

    this.reconnectTimer = setTimeout(() => {
      this.doConnect();
    }, totalDelay);
  }

  disconnect(): void {
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendRaw({ type: 'ping' });
      this.scheduleHeartbeatTimeout();
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private scheduleHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
    }
    this.heartbeatTimeoutTimer = setTimeout(() => {
      console.warn('[CollabWS] Heartbeat timeout, triggering reconnect');
      if (this.ws) {
        this.ws.close();
      }
    }, HEARTBEAT_TIMEOUT);
  }

  private handlePong(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private sendRaw(data: { type: string; payload?: unknown }): void {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(data));
    }
  }

  private enqueue(type: CollabMessageType, payload: unknown): void {
    this.pendingQueue.push({ type, payload, timestamp: Date.now() });
    this.savePendingQueue();
  }

  private sendOrEnqueue(type: CollabMessageType, payload: unknown): void {
    if (this.isConnected()) {
      this.sendRaw({ type, payload });
    } else {
      this.enqueue(type, payload);
    }
  }

  private flushPendingQueue(): void {
    if (this.pendingQueue.length === 0) return;

    console.log(`[CollabWS] Flushing ${this.pendingQueue.length} pending items`);
    const items = [...this.pendingQueue];
    this.pendingQueue = [];
    this.savePendingQueue();

    for (const item of items) {
      this.sendRaw({ type: item.type, payload: item.payload });
    }
  }

  sendOperation(op: CRDTOperationData): void {
    this.sendOrEnqueue('operation', op);
  }

  sendCursor(offset: number): void {
    this.sendOrEnqueue('presence', {
      cursor: { offset },
      last_active: new Date().toISOString(),
    });
  }

  sendSelection(start: number, end: number): void {
    this.sendOrEnqueue('presence', {
      selection: { start, end },
      last_active: new Date().toISOString(),
    });
  }

  sendPresence(presence: Partial<PresenceData>): void {
    this.sendOrEnqueue('presence', {
      ...presence,
      last_active: new Date().toISOString(),
    });
  }

  sendChat(content: string): void {
    this.sendOrEnqueue('chat', {
      content,
      timestamp: new Date().toISOString(),
    });
  }

  sendSyncRequest(since: string): void {
    this.sendOrEnqueue('session_state', { since });
  }

  on<K extends CollabEvent>(event: K, handler: EventHandler<K>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  private emit<K extends CollabEvent>(event: K, payload: EventPayloadMap[K]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach((h) => {
        try {
          h(payload);
        } catch (e) {
          console.error(`[CollabWS] Handler error for event ${event}:`, e);
        }
      });
    }
  }

  get isOpen(): boolean {
    return this.isConnected();
  }

  get pendingCount(): number {
    return this.pendingQueue.length;
  }

  clearPendingQueue(): void {
    this.pendingQueue = [];
    this.savePendingQueue();
  }
}

export const collabWs = new CollabWebSocketService();
