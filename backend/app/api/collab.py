from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..collab.session import collab_session_manager, RESOURCE_TYPE
from ..collab.user import user_manager
from ..collab.chat import chat_manager
from ..collab.history import history_manager
from ..collab.permissions import permission_manager, PermissionType
from ..core.template import template_manager

router = APIRouter(prefix="/collab", tags=["Collaboration"])


class GrantPermissionRequest(BaseModel):
    user_id: str
    permission: str
    granted_by: str


class RevertRequest(BaseModel):
    user_id: str


class CreateSnapshotRequest(BaseModel):
    user_id: str
    user_name: str = ""


class CreateUserRequest(BaseModel):
    name: str
    color: Optional[str] = None


def _chat_channel(doc_id: str) -> str:
    return f"doc_{doc_id}"


@router.get("/users")
async def list_users():
    return [u.to_dict() for u in user_manager.list_users()]


@router.get("/users/search")
async def search_users(keyword: str = Query(..., min_length=1)):
    return [u.to_dict() for u in user_manager.search_users(keyword)]


@router.post("/users")
async def create_user(req: CreateUserRequest):
    user = user_manager.create_user(req.name, req.color)
    return user.to_dict()


@router.get("/users/current")
async def get_current_user(user_id: str = Query(...)):
    user = user_manager.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user.to_dict()


@router.get("/documents/{doc_id}/state")
async def get_document_state(doc_id: str, user_id: str = Query(...)):
    session = collab_session_manager.get_session(doc_id)
    session.initialize()
    if not permission_manager.can_view(RESOURCE_TYPE, doc_id, user_id):
        session.ensure_default_permission(user_id)
    perm = session.get_permission(user_id)
    return {
        "doc_id": doc_id,
        "text": session.get_text(),
        "document": session.document.to_dict(),
        "online_users": session.get_online_users(),
        "permission": perm.value if perm else None,
        "latest_op_timestamp": session._last_op_timestamp,
    }


@router.get("/documents/{doc_id}/permissions")
async def list_permissions(doc_id: str):
    perms = permission_manager.list_resource_permissions(RESOURCE_TYPE, doc_id)
    return [p.to_dict() for p in perms]


@router.post("/documents/{doc_id}/permissions")
async def grant_permission(doc_id: str, req: GrantPermissionRequest):
    try:
        perm = PermissionType(req.permission)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid permission type")
    if not permission_manager.can_edit(RESOURCE_TYPE, doc_id, req.granted_by):
        raise HTTPException(status_code=403, detail="No permission to manage access")
    result = permission_manager.grant_permission(
        RESOURCE_TYPE, doc_id, req.user_id, perm, req.granted_by
    )
    return result.to_dict()


@router.delete("/documents/{doc_id}/permissions/{user_id}")
async def revoke_permission(doc_id: str, user_id: str, granted_by: str = Query(...)):
    if not permission_manager.is_owner(RESOURCE_TYPE, doc_id, granted_by):
        raise HTTPException(status_code=403, detail="Only owner can revoke access")
    if not permission_manager.revoke_permission(RESOURCE_TYPE, doc_id, user_id):
        raise HTTPException(status_code=404, detail="Permission not found")
    return {"message": "Permission revoked"}


@router.post("/documents/{doc_id}/transfer-ownership")
async def transfer_ownership(doc_id: str, from_user_id: str, to_user_id: str):
    if not permission_manager.transfer_ownership(
        RESOURCE_TYPE, doc_id, from_user_id, to_user_id
    ):
        raise HTTPException(status_code=403, detail="Transfer failed")
    return {"message": "Ownership transferred"}


@router.get("/chat/{doc_id}/messages")
async def get_chat_messages(doc_id: str, limit: int = Query(100, le=500), before: Optional[str] = None):
    messages = chat_manager.get_messages(_chat_channel(doc_id), limit=limit, before=before)
    return [m.to_dict() for m in messages]


@router.get("/notifications/{user_id}")
async def get_notifications(user_id: str, unread_only: bool = Query(False)):
    notifs = chat_manager.get_notifications(user_id, unread_only=unread_only)
    return [n.to_dict() for n in notifs]


@router.get("/notifications/{user_id}/unread-count")
async def get_unread_count(user_id: str):
    return {"count": chat_manager.get_unread_count(user_id)}


@router.post("/notifications/{user_id}/read/{notification_id}")
async def mark_notification_read(user_id: str, notification_id: str):
    if not chat_manager.mark_notification_read(user_id, notification_id):
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Marked as read"}


@router.post("/notifications/{user_id}/read-all")
async def mark_all_notifications_read(user_id: str):
    count = chat_manager.mark_all_notifications_read(user_id)
    return {"marked": count}


@router.get("/history/{doc_id}/snapshots")
async def get_snapshots(doc_id: str):
    session = collab_session_manager.get_session(doc_id)
    session.initialize()
    snapshots = history_manager.get_snapshots(doc_id)
    return [s.to_dict() for s in snapshots]


@router.post("/history/{doc_id}/snapshots")
async def create_snapshot(doc_id: str, req: CreateSnapshotRequest):
    session = collab_session_manager.get_session(doc_id)
    session.initialize()
    text = session.get_text()
    user_name = req.user_name
    if not user_name:
        u = user_manager.get_user(req.user_id)
        user_name = u.name if u else req.user_id
    snapshot = history_manager.create_snapshot(doc_id, text, req.user_id, user_name)
    return snapshot.to_dict()


@router.get("/history/{doc_id}/operations")
async def get_operations(doc_id: str, limit: int = Query(200, le=2000), since: Optional[str] = None):
    if since:
        ops = history_manager.get_operations_since(doc_id, since)
    else:
        ops = history_manager.get_operations(doc_id)
    return [o.to_dict() for o in ops[-limit:]]


@router.get("/history/{doc_id}/stats")
async def get_edit_stats(doc_id: str):
    return history_manager.get_user_edit_stats(doc_id)


@router.get("/history/{doc_id}/diff")
async def get_diff(doc_id: str, from_version: int = Query(...), to_version: int = Query(...)):
    changes = history_manager.get_diff_between_versions(doc_id, from_version, to_version)
    return [c.to_dict() for c in changes]


@router.get("/history/{doc_id}/at-time")
async def get_version_at_time(doc_id: str, target_time: str = Query(...)):
    content = history_manager.get_version_at_time(doc_id, target_time)
    if content is None:
        raise HTTPException(status_code=404, detail="No snapshot found at given time")
    return {"content": content}


@router.post("/history/{doc_id}/revert/{version}")
async def revert_to_version(doc_id: str, version: int, req: RevertRequest):
    session = collab_session_manager.get_session(doc_id)
    content = await session.revert_to_version(version, req.user_id)
    if content is None:
        raise HTTPException(status_code=403, detail="Revert not allowed or version not found")
    return {"message": "Reverted", "content": content}


@router.post("/documents/{doc_id}/flush")
async def flush_document(doc_id: str):
    session = collab_session_manager.get_session(doc_id)
    await session.flush_persistence()
    return {"message": "Flushed", "text": session.get_text()}


@router.get("/documents")
async def list_collab_documents(user_id: Optional[str] = None):
    templates = template_manager.list_templates()
    result = []
    for t in templates:
        item = {
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "interpreter": t.interpreter,
            "tags": t.tags,
            "updated_at": t.updated_at,
            "active": False,
            "online_count": 0,
            "permission": None,
        }
        if t.id in collab_session_manager._sessions:
            s = collab_session_manager._sessions[t.id]
            item["active"] = bool(s._connections)
            item["online_count"] = len(s._connections)
        if user_id:
            perm = permission_manager.get_permission(RESOURCE_TYPE, t.id, user_id)
            item["permission"] = perm.value if perm else None
        result.append(item)
    return result
