import json
import re
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
from pathlib import Path

from .user import user_manager
from ..config import settings


@dataclass
class ChatMessage:
    id: str
    channel_id: str
    user_id: str
    user_name: str
    user_color: str
    content: str
    timestamp: str
    mentions: List[str] = field(default_factory=list)
    is_system: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "channel_id": self.channel_id,
            "user_id": self.user_id,
            "user_name": self.user_name,
            "user_color": self.user_color,
            "content": self.content,
            "timestamp": self.timestamp,
            "mentions": self.mentions,
            "is_system": self.is_system,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChatMessage":
        return cls(
            id=data["id"],
            channel_id=data["channel_id"],
            user_id=data["user_id"],
            user_name=data["user_name"],
            user_color=data.get("user_color", "#1890ff"),
            content=data["content"],
            timestamp=data["timestamp"],
            mentions=data.get("mentions", []),
            is_system=data.get("is_system", False),
        )


@dataclass
class Notification:
    id: str
    user_id: str
    type: str
    title: str
    content: str
    timestamp: str
    read: bool = False
    related_doc_id: Optional[str] = None
    related_message_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "type": self.type,
            "title": self.title,
            "content": self.content,
            "timestamp": self.timestamp,
            "read": self.read,
            "related_doc_id": self.related_doc_id,
            "related_message_id": self.related_message_id,
        }


class ChatManager:
    def __init__(self):
        self._messages: Dict[str, List[ChatMessage]] = {}
        self._notifications: Dict[str, List[Notification]] = {}
        self._load_messages()

    def _get_chat_dir(self) -> Path:
        return Path(settings.data_dir) / "chat"

    def _get_messages_file(self, channel_id: str) -> Path:
        return self._get_chat_dir() / f"{channel_id}_messages.json"

    def _get_notifications_file(self, user_id: str) -> Path:
        return self._get_chat_dir() / f"notifications_{user_id}.json"

    def _load_messages(self) -> None:
        chat_dir = self._get_chat_dir()
        if not chat_dir.exists():
            return

        for msg_file in chat_dir.glob("*_messages.json"):
            channel_id = msg_file.stem.replace("_messages", "")
            try:
                with open(msg_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._messages[channel_id] = [
                    ChatMessage.from_dict(m) for m in data
                ]
            except Exception:
                self._messages[channel_id] = []

    def _save_messages(self, channel_id: str) -> None:
        chat_dir = self._get_chat_dir()
        chat_dir.mkdir(parents=True, exist_ok=True)
        msg_file = self._get_messages_file(channel_id)
        data = [m.to_dict() for m in self._messages.get(channel_id, [])]
        with open(msg_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _save_notifications(self, user_id: str) -> None:
        chat_dir = self._get_chat_dir()
        chat_dir.mkdir(parents=True, exist_ok=True)
        notif_file = self._get_notifications_file(user_id)
        data = [n.to_dict() for n in self._notifications.get(user_id, [])]
        with open(notif_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _extract_mentions(self, content: str) -> List[str]:
        pattern = r"@(\S+)"
        matches = re.findall(pattern, content)
        mentioned_user_ids = []
        for name in matches:
            users = user_manager.search_users(name)
            if users:
                mentioned_user_ids.append(users[0].id)
        return mentioned_user_ids

    def send_message(
        self,
        channel_id: str,
        user_id: str,
        content: str,
    ) -> ChatMessage:
        import uuid
        from datetime import datetime
        import uuid

        user = user_manager.get_user(user_id)
        if not user:
            raise ValueError(f"User {user_id} not found")

        mentions = self._extract_mentions(content)

        msg_id = f"msg_{uuid.uuid4().hex[:12]}"
        message = ChatMessage(
            id=msg_id,
            channel_id=channel_id,
            user_id=user_id,
            user_name=user.name,
            user_color=user.color,
            content=content,
            timestamp=datetime.now().isoformat(),
            mentions=mentions,
            is_system=False,
        )

        if channel_id not in self._messages:
            self._messages[channel_id] = []
        self._messages[channel_id].append(message)
        self._save_messages(channel_id)

        for mentioned_uid in mentions:
            if mentioned_uid != user_id:
                self._create_mention_notification(
                    mentioned_uid, user.name, content, channel_id, msg_id
                )

        return message

    def send_system_message(
        self,
        channel_id: str,
        content: str,
    ) -> ChatMessage:
        import uuid
        from datetime import datetime

        msg_id = f"sys_{uuid.uuid4().hex[:12]}"
        message = ChatMessage(
            id=msg_id,
            channel_id=channel_id,
            user_id="system",
            user_name="系统消息",
            user_color="#999999",
            content=content,
            timestamp=datetime.now().isoformat(),
            mentions=[],
            is_system=True,
        )

        if channel_id not in self._messages:
            self._messages[channel_id] = []
        self._messages[channel_id].append(message)
        self._save_messages(channel_id)

        return message

    def get_messages(
        self,
        channel_id: str,
        limit: int = 100,
        before: Optional[str] = None,
    ) -> List[ChatMessage]:
        messages = self._messages.get(channel_id, [])
        if before:
            messages = [m for m in messages if m.timestamp < before]
        return messages[-limit:]

    def _create_mention_notification(
        self,
        user_id: str,
        from_user_name: str,
        content: str,
        channel_id: str,
        message_id: str,
    ) -> None:
        import uuid
        from datetime import datetime

        notif = Notification(
            id=f"notif_{uuid.uuid4().hex[:12]}",
            user_id=user_id,
            type="mention",
            title=f"{from_user_name} 提到了你",
            content=content[:100],
            timestamp=datetime.now().isoformat(),
            read=False,
            related_doc_id=channel_id,
            related_message_id=message_id,
        )

        if user_id not in self._notifications:
            self._notifications[user_id] = []
        self._notifications[user_id].append(notif)
        self._save_notifications(user_id)

    def get_notifications(self, user_id: str, unread_only: bool = False) -> List[Notification]:
        notifs = self._notifications.get(user_id, [])
        if unread_only:
            notifs = [n for n in notifs if not n.read]
        return sorted(notifs, key=lambda n: n.timestamp, reverse=True)

    def mark_notification_read(self, user_id: str, notification_id: str) -> bool:
        notifs = self._notifications.get(user_id, [])
        for n in notifs:
            if n.id == notification_id:
                n.read = True
                self._save_notifications(user_id)
                return True
        return False

    def mark_all_notifications_read(self, user_id: str) -> int:
        notifs = self._notifications.get(user_id, [])
        count = 0
        for n in notifs:
            if not n.read:
                n.read = True
                count += 1
        if count > 0:
            self._save_notifications(user_id)
        return count

    def get_unread_count(self, user_id: str) -> int:
        notifs = self._notifications.get(user_id, [])
        return sum(1 for n in notifs if not n.read)


chat_manager = ChatManager()
