import json
from typing import Dict, Optional, List, Set
from dataclasses import dataclass, field
from pathlib import Path
from enum import Enum

from .user import PermissionType, PERMISSION_HIERARCHY, User, user_manager
from ..config import settings


@dataclass
class ResourcePermission:
    resource_type: str
    resource_id: str
    user_id: str
    permission: PermissionType
    granted_at: str
    granted_by: str

    def to_dict(self) -> Dict:
        return {
            "resource_type": self.resource_type,
            "resource_id": self.resource_id,
            "user_id": self.user_id,
            "permission": self.permission.value,
            "granted_at": self.granted_at,
            "granted_by": self.granted_by,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "ResourcePermission":
        return cls(
            resource_type=data["resource_type"],
            resource_id=data["resource_id"],
            user_id=data["user_id"],
            permission=PermissionType(data["permission"]),
            granted_at=data["granted_at"],
            granted_by=data["granted_by"],
        )


class PermissionManager:
    def __init__(self):
        self._permissions: Dict[str, Dict[str, ResourcePermission]] = {}
        self._load_permissions()

    def _get_permissions_file(self) -> Path:
        return Path(settings.data_dir) / "permissions.json"

    def _load_permissions(self) -> None:
        perm_file = self._get_permissions_file()
        if perm_file.exists():
            try:
                with open(perm_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for res_key, perms in data.items():
                    self._permissions[res_key] = {}
                    for uid, perm_data in perms.items():
                        self._permissions[res_key][uid] = ResourcePermission.from_dict(perm_data)
            except Exception:
                pass

    def _save_permissions(self) -> None:
        perm_file = self._get_permissions_file()
        perm_file.parent.mkdir(parents=True, exist_ok=True)
        data = {}
        for res_key, perms in self._permissions.items():
            data[res_key] = {uid: p.to_dict() for uid, p in perms.items()}
        with open(perm_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _get_key(self, resource_type: str, resource_id: str) -> str:
        return f"{resource_type}:{resource_id}"

    def grant_permission(
        self,
        resource_type: str,
        resource_id: str,
        user_id: str,
        permission: PermissionType,
        granted_by: str,
    ) -> ResourcePermission:
        from datetime import datetime
        from datetime import datetime

        key = self._get_key(resource_type, resource_id)
        if key not in self._permissions:
            self._permissions[key] = {}

        perm = ResourcePermission(
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=user_id,
            permission=permission,
            granted_at=datetime.now().isoformat(),
            granted_by=granted_by,
        )
        self._permissions[key][user_id] = perm
        self._save_permissions()
        return perm

    def revoke_permission(self, resource_type: str, resource_id: str, user_id: str) -> bool:
        key = self._get_key(resource_type, resource_id)
        if key in self._permissions and user_id in self._permissions[key]:
            del self._permissions[key][user_id]
            if not self._permissions[key]:
                del self._permissions[key]
            self._save_permissions()
            return True
        return False

    def get_permission(self, resource_type: str, resource_id: str, user_id: str) -> Optional[PermissionType]:
        key = self._get_key(resource_type, resource_id)
        if key in self._permissions and user_id in self._permissions[key]:
            return self._permissions[key][user_id].permission
        return None

    def has_permission(
        self,
        resource_type: str,
        resource_id: str,
        user_id: str,
        required_permission: PermissionType,
    ) -> bool:
        perm = self.get_permission(resource_type, resource_id, user_id)
        if perm is None:
            if required_permission == PermissionType.VIEWER:
                return True
            return False
        return required_permission.value in PERMISSION_HIERARCHY[perm]

    def can_edit(self, resource_type: str, resource_id: str, user_id: str) -> bool:
        return self.has_permission(resource_type, resource_id, user_id, PermissionType.EDITOR)

    def can_comment(self, resource_type: str, resource_id: str, user_id: str) -> bool:
        return self.has_permission(resource_type, resource_id, user_id, PermissionType.COMMENTER)

    def can_view(self, resource_type: str, resource_id: str, user_id: str) -> bool:
        return self.has_permission(resource_type, resource_id, user_id, PermissionType.VIEWER)

    def is_owner(self, resource_type: str, resource_id: str, user_id: str) -> bool:
        perm = self.get_permission(resource_type, resource_id, user_id)
        return perm == PermissionType.OWNER

    def list_resource_permissions(
        self, resource_type: str, resource_id: str
    ) -> List[ResourcePermission]:
        key = self._get_key(resource_type, resource_id)
        if key in self._permissions:
            return list(self._permissions[key].values())
        return []

    def list_user_resources(self, user_id: str) -> List[ResourcePermission]:
        result = []
        for perms in self._permissions.values():
            if user_id in perms:
                result.append(perms[user_id])
        return result

    def transfer_ownership(
        self,
        resource_type: str,
        resource_id: str,
        from_user_id: str,
        to_user_id: str,
    ) -> bool:
        if not self.is_owner(resource_type, resource_id, from_user_id):
            return False
        self.grant_permission(
            resource_type, resource_id, to_user_id, PermissionType.OWNER, from_user_id
        )
        self.grant_permission(
            resource_type, resource_id, from_user_id, PermissionType.EDITOR, to_user_id
        )
        return True


permission_manager = PermissionManager()
