import asyncio
import json
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import WebSocket

from .crdt import CRDTDocument, CRDTOperation, CRDTChar, Position
from .user import user_manager, User
from .history import history_manager, HistorySnapshot
from .chat import chat_manager, ChatMessage
from .permissions import permission_manager, PermissionType
from ..core.template import template_manager
from ..config import settings


RESOURCE_TYPE = "template"
SNAPSHOT_INTERVAL = 40
TEMPLATE_PERSIST_INTERVAL = 25


def _wrap_send(type_name: str, data: Any) -> Dict[str, Any]:
    return {"type": type_name, "payload": data}


@dataclass
class Presence:
    user_id: str
    user_name: str
    user_color: str
    cursor: Optional[Dict[str, Any]] = None
    selection: Optional[Dict[str, Any]] = None
    last_active: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "user_name": self.user_name,
            "user_color": self.user_color,
            "cursor": self.cursor,
            "selection": self.selection,
            "last_active": self.last_active,
        }


class CollabSession:
    def __init__(self, doc_id: str):
        self.doc_id = doc_id
        self.document: CRDTDocument = CRDTDocument(doc_id)
        self._connections: Dict[WebSocket, str] = {}
        self._presence: Dict[str, Presence] = {}
        self._lock = asyncio.Lock()
        self._initialized = False
        self._ops_since_snapshot = 0
        self._ops_since_persist = 0
        self._last_op_timestamp = ""

    def _get_doc_dir(self) -> Path:
        return Path(settings.data_dir) / "collab" / "docs"

    def _get_doc_file(self) -> Path:
        return self._get_doc_dir() / f"{self.doc_id}.json"

    def initialize(self) -> None:
        if self._initialized:
            return
        doc_file = self._get_doc_file()
        loaded = False
        if doc_file.exists():
            try:
                with open(doc_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.document = CRDTDocument.from_dict(data)
                loaded = True
            except Exception:
                loaded = False

        if not loaded:
            template = template_manager.get_template(self.doc_id)
            initial_text = template.script_content if template else ""
            if initial_text:
                self.document.load_from_text(
                    initial_text,
                    site="bootstrap",
                    user_id="system",
                    user_name="系统",
                )
            self._save_document()

        ops = history_manager.get_operations(self.doc_id)
        if ops:
            self._last_op_timestamp = ops[-1].timestamp

        self._initialized = True

    def _save_document(self) -> None:
        doc_dir = self._get_doc_dir()
        doc_dir.mkdir(parents=True, exist_ok=True)
        with open(self._get_doc_file(), "w", encoding="utf-8") as f:
            json.dump(self.document.to_dict(), f, ensure_ascii=False, indent=2)

    def ensure_default_permission(self, user_id: str) -> Optional[PermissionType]:
        existing = permission_manager.list_resource_permissions(RESOURCE_TYPE, self.doc_id)
        if not existing:
            permission_manager.grant_permission(
                RESOURCE_TYPE, self.doc_id, user_id, PermissionType.OWNER, user_id
            )
            return PermissionType.OWNER
        perm = permission_manager.get_permission(RESOURCE_TYPE, self.doc_id, user_id)
        return perm

    def get_text(self) -> str:
        return self.document.get_text()

    def get_online_users(self) -> List[Dict[str, Any]]:
        return [p.to_dict() for p in self._presence.values()]

    def get_session_state(self) -> Dict[str, Any]:
        perm = None
        first_uid = next(iter(self._connections.values()), None)
        if first_uid:
            perm = permission_manager.get_permission(RESOURCE_TYPE, self.doc_id, first_uid)
        return {
            "doc_id": self.doc_id,
            "document": self.document.to_dict(),
            "text": self.get_text(),
            "online_users": self.get_online_users(),
            "latest_op_timestamp": self._last_op_timestamp,
            "permission": perm.value if perm else None,
        }

    async def _send(self, ws: WebSocket, type_name: str, message: Any = None) -> None:
        try:
            if message is None:
                await ws.send_text(json.dumps({"type": type_name}, ensure_ascii=False))
            else:
                await ws.send_text(json.dumps(_wrap_send(type_name, message), ensure_ascii=False))
        except Exception:
            pass

    async def _broadcast(self, type_name: str, message: Any, exclude: Optional[WebSocket] = None) -> None:
        dead: List[WebSocket] = []
        for ws in list(self._connections.keys()):
            if ws is exclude:
                continue
            try:
                await ws.send_text(json.dumps(_wrap_send(type_name, message), ensure_ascii=False))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections.pop(ws, None)

    async def join(self, ws: WebSocket, user_id: str) -> Dict[str, Any]:
        async with self._lock:
            self.initialize()
            self.ensure_default_permission(user_id)
            user = user_manager.get_user(user_id)
            if not user:
                raise ValueError(f"User {user_id} not found")

            self._connections[ws] = user_id
            user_manager.set_online(user_id, True)
            presence = Presence(
                user_id=user_id,
                user_name=user.name,
                user_color=user.color,
            )
            self._presence[user_id] = presence

            state = self.get_session_state()
            perm = permission_manager.get_permission(RESOURCE_TYPE, self.doc_id, user_id)
            state["permission"] = perm.value if perm else None
            await self._send(ws, "session_state", state)

            await self._broadcast(
                "user_joined", presence.to_dict(),
                exclude=ws,
            )

            chat_channel = f"doc_{self.doc_id}"
            messages = chat_manager.get_messages(chat_channel, limit=50)
            await self._send(
                ws,
                "chat_history",
                [m.to_dict() for m in messages],
            )
            return state

    async def leave(self, ws: WebSocket) -> None:
        async with self._lock:
            user_id = self._connections.pop(ws, None)
            if not user_id:
                return
            self._presence.pop(user_id, None)
            still_online = user_id in self._connections.values()
            if not still_online:
                user_manager.set_online(user_id, False)
            await self._broadcast("user_left", {"user_id": user_id})

    async def handle_operation(self, user_id: str, op_data: Dict[str, Any]) -> None:
        async with self._lock:
            if not permission_manager.can_edit(RESOURCE_TYPE, self.doc_id, user_id):
                return
            try:
                op = CRDTOperation.from_dict(op_data)
            except Exception:
                return

            applied, _, _ = self.document.apply_operation(op)
            if not applied:
                return

            op.timestamp = datetime.now().isoformat()
            self._last_op_timestamp = op.timestamp

            history_manager.record_operation(self.doc_id, op)
            self._ops_since_snapshot += 1
            self._ops_since_persist += 1

            if self._ops_since_snapshot >= SNAPSHOT_INTERVAL:
                history_manager.create_snapshot(
                    self.doc_id,
                    self.get_text(),
                    op.user_id,
                    op.user_name,
                    [o.to_dict() for o in history_manager.get_operations(self.doc_id)[-SNAPSHOT_INTERVAL:]],
                )
                self._ops_since_snapshot = 0

            if self._ops_since_persist >= TEMPLATE_PERSIST_INTERVAL:
                self._persist_to_template(op.user_id, op.user_name)
                self._ops_since_persist = 0

            await self._broadcast(
                "operation", {"op": op.to_dict(), "origin_user_id": user_id}
            )

    def _persist_to_template(self, user_id: str, user_name: str) -> None:
        text = self.get_text()
        template = template_manager.get_template(self.doc_id)
        if template:
            template.script_content = text
            template.updated_at = datetime.now().isoformat()
            template_manager._save_script(template)
            template_manager._save_meta()
        self._save_document()

    async def flush_persistence(self) -> None:
        async with self._lock:
            self._persist_to_template("system", "系统")
            self._ops_since_persist = 0

    async def set_cursor(self, user_id: str, offset: int) -> None:
        async with self._lock:
            presence = self._presence.get(user_id)
            if not presence:
                return
            presence.cursor = {"offset": offset}
            presence.last_active = datetime.now().isoformat()
            await self._broadcast(
                "presence", presence.to_dict()
            )

    async def set_selection(self, user_id: str, start: int, end: int) -> None:
        async with self._lock:
            presence = self._presence.get(user_id)
            if not presence:
                return
            presence.selection = {"start": start, "end": end}
            presence.cursor = {"offset": start if start <= end else end}
            presence.last_active = datetime.now().isoformat()
            await self._broadcast(
                "presence", presence.to_dict()
            )

    async def handle_chat(self, user_id: str, content: str) -> Optional[ChatMessage]:
        if not permission_manager.can_comment(RESOURCE_TYPE, self.doc_id, user_id):
            return None
        chat_channel = f"doc_{self.doc_id}"
        message = chat_manager.send_message(chat_channel, user_id, content)
        mentioned_ids = message.mentions

        await self._broadcast("chat", message.to_dict())

        for mentioned_uid in mentioned_ids:
            if mentioned_uid in self._presence:
                notifs = chat_manager.get_notifications(mentioned_uid, unread_only=True)
                latest = notifs[0] if notifs else None
                if latest:
                    await self._broadcast(
                        "notification",
                        {"notification": latest.to_dict(), "target_user_id": mentioned_uid},
                    )
        return message

    async def sync_since(self, ws: WebSocket, user_id: str, since: str) -> None:
        async with self._lock:
            ops = history_manager.get_operations_since(self.doc_id, since or "")
            await self._send(
                ws,
                "operations_batch",
                {"ops": [o.to_dict() for o in ops], "latest_op_timestamp": self._last_op_timestamp},
            )

    async def revert_to_version(self, version: int, user_id: str) -> Optional[str]:
        async with self._lock:
            if not permission_manager.is_owner(RESOURCE_TYPE, self.doc_id, user_id):
                return None
            content = history_manager.revert_to_version(self.doc_id, version, self.document)
            if content is None:
                return None
            self.document = CRDTDocument(self.doc_id)
            self.document.load_from_text(content, site="revert", user_id=user_id, user_name=user_name_display(user_id))
            self._save_document()
            history_manager.create_snapshot(
                self.doc_id, content, user_id, user_name_display(user_id)
            )
            await self._broadcast(
                "session_state",
                self.get_session_state(),
            )
            return content

    def get_permission(self, user_id: str) -> Optional[PermissionType]:
        return permission_manager.get_permission(RESOURCE_TYPE, self.doc_id, user_id)


def user_name_display(user_id: str) -> str:
    user = user_manager.get_user(user_id)
    return user.name if user else user_id


class CollabSessionManager:
    def __init__(self):
        self._sessions: Dict[str, CollabSession] = {}
        self._lock = asyncio.Lock()

    def get_session(self, doc_id: str) -> CollabSession:
        if doc_id not in self._sessions:
            self._sessions[doc_id] = CollabSession(doc_id)
        return self._sessions[doc_id]

    async def join(self, doc_id: str, ws: WebSocket, user_id: str) -> Dict[str, Any]:
        session = self.get_session(doc_id)
        return await session.join(ws, user_id)

    async def leave(self, doc_id: str, ws: WebSocket) -> None:
        if doc_id in self._sessions:
            await self._sessions[doc_id].leave(ws)

    def list_active_docs(self) -> List[str]:
        return [doc_id for doc_id, s in self._sessions.items() if s._connections]


collab_session_manager = CollabSessionManager()
