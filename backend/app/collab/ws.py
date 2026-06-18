import json
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect, Query

from .session import collab_session_manager


def _unwrap(message: dict, key: str, default=None):
    """兼容扁平格式 {type, ...} 和包装格式 {type, payload: {...}}
    """
    if key in message:
        return message[key]
    payload = message.get("payload")
    if isinstance(payload, dict) and key in payload:
        return payload[key]
    return default


async def handle_collab_websocket(
    websocket: WebSocket,
    doc_id: str = Query(...),
    user_id: str = Query(...),
) -> None:
    await websocket.accept()

    try:
        state = await collab_session_manager.join(doc_id, websocket, user_id)
    except Exception as e:
        await websocket.send_text(json.dumps({"type": "error", "payload": {"message": str(e)}}))
        await websocket.close()
        return

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = message.get("type")
            session = collab_session_manager.get_session(doc_id)

            if msg_type == "presence":
                payload = message.get("payload", {}) if isinstance(message.get("payload"), dict) else message
                cursor = payload.get("cursor")
                selection = payload.get("selection")
                if cursor and isinstance(cursor, dict) and "offset" in cursor:
                    await session.set_cursor(user_id, int(cursor["offset"]))
                if selection and isinstance(selection, dict) and "start" in selection and "end" in selection:
                    await session.set_selection(
                        user_id,
                        int(selection["start"]),
                        int(selection["end"]),
                    )
            elif msg_type == "cursor":
                offset = _unwrap(message, "offset", 0)
                await session.set_cursor(user_id, int(offset))
            elif msg_type == "selection":
                start = int(_unwrap(message, "start", 0))
                end = int(_unwrap(message, "end", 0))
                await session.set_selection(user_id, start, end)
            elif msg_type == "operation":
                op = _unwrap(message, "op")
                if op:
                    await session.handle_operation(user_id, op)
            elif msg_type == "sync_request":
                since = _unwrap(message, "since", "")
                await session.sync_since(websocket, user_id, since)
            elif msg_type == "session_state":
                since = _unwrap(message, "since", "")
                await session.sync_since(websocket, user_id, since)
            elif msg_type == "chat":
                content = _unwrap(message, "content", "")
                if content:
                    await session.handle_chat(user_id, content)
            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await collab_session_manager.leave(doc_id, websocket)
