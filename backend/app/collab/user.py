import json
import uuid
from typing import Dict, Optional, List, Set
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path

from ..config import settings


class PermissionType(str, Enum):
    OWNER = "owner"
    EDITOR = "editor"
    COMMENTER = "commenter"
    VIEWER = "viewer"


PERMISSION_HIERARCHY = {
    PermissionType.OWNER: {"owner", "editor", "commenter", "viewer"},
    PermissionType.EDITOR: {"editor", "commenter", "viewer"},
    PermissionType.COMMENTER: {"commenter", "viewer"},
    PermissionType.VIEWER: {"viewer"},
}


@dataclass
class User:
    id: str
    name: str
    color: str
    avatar: str = ""
    is_online: bool = False
    last_seen: Optional[str] = None

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> "User":
        return cls(**data)


class UserManager:
    def __init__(self):
        self._users: Dict[str, User] = {}
        self._load_users()

    def _get_users_file(self) -> Path:
        return Path(settings.data_dir) / "users.json"

    def _load_users(self) -> None:
        users_file = self._get_users_file()
        if users_file.exists():
            try:
                with open(users_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for uid, user_data in data.items():
                    self._users[uid] = User.from_dict(user_data)
            except Exception:
                pass

        if not self._users:
            self._create_default_users()

    def _save_users(self) -> None:
        users_file = self._get_users_file()
        users_file.parent.mkdir(parents=True, exist_ok=True)
        data = {uid: u.to_dict() for uid, u in self._users.items()}
        with open(users_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _create_default_users(self) -> None:
        colors = ["#1890ff", "#52c41a", "#faad14", "#f5222d", "#722ed1", "#eb2f96"]
        names = ["张三", "李四", "王五", "赵六", "钱七", "孙八"]
        for i, name in enumerate(names):
            user_id = f"user_{i+1}"
            self._users[user_id] = User(
                id=user_id,
                name=name,
                color=colors[i % len(colors)],
                avatar=f"https://api.dicebear.com/7.x/avataaars/svg?seed={user_id}",
                is_online=False,
            )
        self._save_users()

    def get_user(self, user_id: str) -> Optional[User]:
        return self._users.get(user_id)

    def list_users(self) -> List[User]:
        return list(self._users.values())

    def set_online(self, user_id: str, online: bool) -> Optional[User]:
        from datetime import datetime
        user = self._users.get(user_id)
        if user:
            user.is_online = online
            user.last_seen = datetime.now().isoformat() if not online else user.last_seen
            self._save_users()
            return user
        return None

    def create_user(self, name: str, color: Optional[str] = None) -> User:
        import random
        user_id = f"user_{uuid.uuid4().hex[:8]}"
        if not color:
            colors = ["#1890ff", "#52c41a", "#faad14", "#f5222d", "#722ed1", "#eb2f96", "#13c2c2", "#fa8c16"]
            color = random.choice(colors)
        user = User(
            id=user_id,
            name=name,
            color=color,
            avatar=f"https://api.dicebear.com/7.x/avataaars/svg?seed={user_id}",
            is_online=False,
        )
        self._users[user_id] = user
        self._save_users()
        return user

    def search_users(self, keyword: str) -> List[User]:
        kw = keyword.lower()
        return [u for u in self._users.values() if kw in u.name.lower()]


user_manager = UserManager()
