export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  private_key: string;
  tags: string[];
}

export interface ExecutionResult {
  task_id: string;
  server_id: string;
  server_name: string;
  command: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  start_time: string;
  end_time: string | null;
  status: 'pending' | 'running' | 'success' | 'failed' | 'error';
}

export interface StreamMessage {
  type: 'output' | 'status';
  task_id: string;
  server_id: string;
  server_name: string;
  stream: 'stdout' | 'stderr' | '';
  content: string;
  exit_code: number | null;
  status: string;
  timestamp: string;
}

export interface ScriptTemplate {
  id: string;
  name: string;
  description: string;
  script_content: string;
  interpreter: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  task_id: string;
  server_name: string;
  server_id: string;
  command: string;
  script_name: string | null;
  start_time: string;
  end_time: string;
  status: string;
  exit_code: number | null;
  output: string;
  log_file: string;
}

export interface CommandExecuteRequest {
  server_ids: string[];
  command: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ScriptExecuteRequest {
  server_ids: string[];
  script_content: string;
  script_name?: string;
  interpreter?: string;
  args?: string[];
  timeout?: number;
}

import type {
  PositionData as _PositionData,
  CRDTCharData as _CRDTCharData,
  CRDTOperationData as _CRDTOperationData,
  CRDTDocumentData as _CRDTDocumentData,
} from '../lib/crdt';

export type PositionData = _PositionData;
export type CRDTCharData = _CRDTCharData;
export type CRDTOperationData = _CRDTOperationData;
export type CRDTDocumentData = _CRDTDocumentData;

export interface PresenceData {
  user_id: string;
  user_name: string;
  user_color: string;
  cursor?: { offset: number };
  selection?: { start: number; end: number };
  last_active: string;
}

export interface ChatMessageData {
  id: string;
  channel_id: string;
  user_id: string;
  user_name: string;
  user_color: string;
  content: string;
  timestamp: string;
  mentions: string[];
  is_system: boolean;
}

export interface NotificationData {
  id: string;
  user_id: string;
  type: string;
  title: string;
  content: string;
  timestamp: string;
  read: boolean;
  related_doc_id?: string;
  related_message_id?: string;
}

export interface HistorySnapshotData {
  version: number;
  timestamp: string;
  user_id: string;
  user_name: string;
  content: string;
  operations?: CRDTOperationData[];
}

export interface DiffChangeData {
  type: 'insert' | 'delete' | 'replace';
  index: number;
  char: string;
  user_id: string;
  user_name: string;
  timestamp: string;
}

export type PermissionLevel = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface PermissionData {
  resource_type: string;
  resource_id: string;
  user_id: string;
  permission: PermissionLevel;
  granted_at: string;
  granted_by: string;
}

export interface CollabSessionState {
  doc_id: string;
  document: CRDTDocumentData;
  text: string;
  online_users: PresenceData[];
  latest_op_timestamp: string;
  permission?: PermissionLevel;
}

export type CollabMessageType =
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
  | 'pong';
